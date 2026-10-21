import type { CacheRepositories } from '@pulls.review/core/cache'
import type { GitlabMergeRequestFilters, GitlabNamespaceKind } from '@pulls.review/core/gitlab'
import type { Credentials, PullRequestListItem, PullRequestListPage, SourceRef } from '@pulls.review/core/types'
import type { ListedRepository } from '../source-routes'
import { createGithubClient, fetchOpenPullRequests } from '@pulls.review/core/github'
import { createGitlabClient, DEFAULT_GITLAB_MR_FILTERS, fetchGitlabLabelNames, fetchGitlabUsername, fetchMergeRequests, resolveGitlabNamespace } from '@pulls.review/core/gitlab'
import { computed, reactive, ref, shallowRef } from 'vue'
import { ruleBasedAdapter } from '../analyze'
import { listItemRoute } from '../source-routes'

/** What this browser already holds for a PR it viewed before (see `pr:*` in the cache). */
export interface ViewedPullRequest {
  additions: number
  deletions: number
  files: number
  /** From the AI result when one is stored, else the always-available rule-based grouping. */
  groups: number
  hasAiResult: boolean
}

export interface PullRequestListStore {
  readonly repository: ListedRepository
  readonly items: PullRequestListItem[]
  /** What a GitLab list is narrowed to; undefined for GitHub, whose list has no filters. */
  readonly filters: GitlabMergeRequestFilters | undefined
  /** Labels a GitLab merge request in this list can carry, for the label filter's choices. */
  readonly labelOptions: string[]
  /** PR count for the whole repo, of the chosen state on GitLab (not just the loaded pages); unset until the first page lands. */
  readonly totalCount: number | undefined
  /** First load with nothing to show yet. */
  readonly isLoading: boolean
  /** A fresh first page is on its way while the current (cached or previous) list stays visible. */
  readonly isRefreshing: boolean
  readonly isLoadingMore: boolean
  readonly hasMore: boolean
  readonly error: Error | undefined
  /** Locally cached diffs of this repo, by the item's `listItemRoute` - numbers repeat across a GitLab group's projects. */
  readonly viewed: ReadonlyMap<string, ViewedPullRequest>
  load: () => Promise<void>
  /** Replaces the GitLab filters and refetches the first page; the old list is dropped, not kept beside the new one. */
  setFilters: (filters: GitlabMergeRequestFilters) => Promise<void>
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  /** Fetches every remaining page - client-side search needs the full set to be trustworthy. */
  loadAll: () => Promise<void>
}

export interface PullRequestListStoreOptions {
  cache: CacheRepositories
  credentials: Credentials
  /** The GitLab filters to start from (the page URL's); ignored for GitHub. */
  filters?: GitlabMergeRequestFilters
}

/**
 * Stale-while-revalidate over a repo's open PRs: the cached first page (if any)
 * renders instantly, a fresh first page replaces it, further pages append. Lists
 * cost nothing to refetch (no AI run hangs off them), so unlike `DiffsStore` the
 * refresh happens silently on every visit.
 */
/**
 * A GitLab path's pages: a project's merge requests, or a group's with its subgroups'.
 * Which one it is resolves once, on the first page, and so does the token's username
 * (only the "mine" filter needs it).
 */
function gitlabList(path: string, client: ReturnType<typeof createGitlabClient>, currentFilters: () => GitlabMergeRequestFilters) {
  let kind: Promise<GitlabNamespaceKind> | undefined
  let username: Promise<string> | undefined
  const namespace = () => kind ??= resolveGitlabNamespace(client, path)
  return {
    async fetchPage(next?: string) {
      const filters = currentFilters()
      return fetchMergeRequests(client, path, {
        filters,
        username: filters.mine
          ? await (username ??= fetchGitlabUsername(client).catch((err) => {
              username = undefined
              throw err
            }))
          : undefined,
        next,
        kind: await namespace(),
      })
    },
    async fetchLabelNames() {
      return fetchGitlabLabelNames(client, path, await namespace())
    },
  }
}

function githubList(owner: string, repo: string, client: ReturnType<typeof createGithubClient>) {
  return { fetchPage: (next?: string) => fetchOpenPullRequests(client, owner, repo, next), fetchLabelNames: undefined }
}

export function createPullRequestListStore(repository: ListedRepository, opts: PullRequestListStoreOptions): PullRequestListStore {
  const { cache } = opts
  const filters = ref<GitlabMergeRequestFilters | undefined>('host' in repository ? opts.filters ?? DEFAULT_GITLAB_MR_FILTERS : undefined)
  const { fetchPage, fetchLabelNames } = 'host' in repository
    ? gitlabList(repository.project, createGitlabClient(repository.host, opts.credentials), () => filters.value ?? DEFAULT_GITLAB_MR_FILTERS)
    : githubList(repository.owner, repository.repo, createGithubClient(opts.credentials))
  // The list cache is keyed by GitHub's `owner/repo` and feeds the home page's recent
  // repositories as GitHub links, so a GitLab list is always fetched fresh instead.
  const listCache = 'owner' in repository ? { owner: repository.owner, repo: repository.repo } : undefined
  /** The list row a cached diff belongs to; a group's list holds its subgroups' projects too. */
  function itemOf(ref: SourceRef): { number: number, repository?: string } | undefined {
    if ('host' in repository) {
      const inList = ref.kind === 'gitlab-mr' && ref.host === repository.host
        && (ref.project === repository.project || ref.project.startsWith(`${repository.project}/`))
      return inList ? { number: Number(ref.iid), repository: ref.project === repository.project ? undefined : ref.project } : undefined
    }
    return ref.kind === 'github-pr' && ref.owner === repository.owner && ref.repo === repository.repo ? { number: Number(ref.number) } : undefined
  }
  const items = shallowRef<PullRequestListItem[]>([])
  const totalCount = ref<number>()
  const next = ref<string>()
  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const isLoadingMore = ref(false)
  const error = ref<Error>()
  const labelOptions = ref<string[]>([])
  const viewed = shallowRef(new Map<string, ViewedPullRequest>())
  // Bumped by every first-page fetch so a slower, older response can't overwrite a newer list.
  let generation = 0

  function installFirstPage(page: PullRequestListPage) {
    items.value = page.items
    totalCount.value = page.totalCount
    next.value = page.next
  }

  async function fetchFirstPage() {
    const current = ++generation
    error.value = undefined
    try {
      const page = await fetchPage()
      if (current !== generation)
        return
      installFirstPage(page)
      if (listCache)
        await cache.pullRequestLists.set(listCache.owner, listCache.repo, page)
    }
    catch (err) {
      if (current === generation)
        error.value = err instanceof Error ? err : new Error(String(err))
    }
  }

  async function loadViewed() {
    const next = new Map<string, ViewedPullRequest>()
    const entries = await cache.diffs.listMatching(({ ref }) => itemOf(ref) !== undefined)
    for (const entry of entries) {
      const item = itemOf(entry.diff.ref)
      if (!item)
        continue
      const aiResult = entry.analyzedBy.llm ?? entry.analyzedBy['web-llm']
      next.set(listItemRoute(repository, item), {
        additions: entry.diff.files.reduce((sum, file) => sum + file.additions, 0),
        deletions: entry.diff.files.reduce((sum, file) => sum + file.deletions, 0),
        files: entry.diff.files.length,
        groups: aiResult ? aiResult.groups.length : (await ruleBasedAdapter.analyze(entry.diff)).groups.length,
        hasAiResult: !!aiResult,
      })
    }
    viewed.value = next
  }

  async function load() {
    // Independent of the network: what's viewed locally decorates rows whenever they arrive.
    void loadViewed()
    // Only the filter's choices depend on it, so a failure leaves them empty instead of failing the list.
    void fetchLabelNames?.().then((names) => {
      labelOptions.value = names
    }).catch(() => {})
    const cached = listCache && await cache.pullRequestLists.get(listCache.owner, listCache.repo)
    if (cached && listCache) {
      installFirstPage(cached.page)
      // Counts as a visit even if the refresh below fails (offline, rate-limited).
      await cache.pullRequestLists.touch(listCache.owner, listCache.repo)
    }
    const flag = cached ? isRefreshing : isLoading
    flag.value = true
    try {
      await fetchFirstPage()
    }
    finally {
      flag.value = false
    }
  }

  async function setFilters(value: GitlabMergeRequestFilters) {
    filters.value = value
    items.value = []
    totalCount.value = undefined
    next.value = undefined
    isLoading.value = true
    const request = fetchFirstPage()
    const current = generation
    try {
      await request
    }
    finally {
      // A newer filter change owns the loading state now.
      if (current === generation)
        isLoading.value = false
    }
  }

  async function refresh() {
    isRefreshing.value = true
    try {
      await fetchFirstPage()
    }
    finally {
      isRefreshing.value = false
    }
  }

  async function loadMore() {
    const cursor = next.value
    if (!cursor || isLoadingMore.value)
      return
    const current = generation
    isLoadingMore.value = true
    error.value = undefined
    try {
      const page = await fetchPage(cursor)
      // A refresh landed meanwhile: its first page supersedes this continuation.
      if (current !== generation)
        return
      items.value = [...items.value, ...page.items]
      totalCount.value = page.totalCount
      next.value = page.next
    }
    catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
    }
    finally {
      isLoadingMore.value = false
    }
  }

  async function loadAll() {
    while (next.value && !error.value)
      await loadMore()
  }

  return reactive({
    repository,
    items,
    totalCount,
    isLoading,
    isRefreshing,
    isLoadingMore,
    filters,
    labelOptions,
    hasMore: computed(() => next.value !== undefined),
    error,
    viewed,
    load,
    setFilters,
    refresh,
    loadMore,
    loadAll,
  }) as PullRequestListStore
}
