import type { CacheRepositories, PrCacheEntry } from '@pulls.review/core/cache'
import type { PullRequestListItem, PullRequestListPage } from '@pulls.review/core/types'
import type { Storage } from 'unstorage'
import { createCacheRepositories } from '@pulls.review/core/cache'
import { staticCredentials } from '@pulls.review/core/types'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPullRequestListStore } from './pull-request-list-store'

let storage: Storage
let cache: CacheRepositories

const mocks = vi.hoisted(() => ({
  fetchOpenPullRequests: vi.fn(),
  fetchMergeRequests: vi.fn(),
  fetchGitlabUsername: vi.fn(),
  fetchGitlabLabelNames: vi.fn(),
  resolveGitlabNamespace: vi.fn(),
}))

vi.mock('@pulls.review/core/gitlab', async importOriginal => ({
  ...await importOriginal<typeof import('@pulls.review/core/gitlab')>(),
  fetchMergeRequests: mocks.fetchMergeRequests,
  fetchGitlabUsername: mocks.fetchGitlabUsername,
  fetchGitlabLabelNames: mocks.fetchGitlabLabelNames,
  resolveGitlabNamespace: mocks.resolveGitlabNamespace,
}))

vi.mock('@pulls.review/core/github', async importOriginal => ({
  ...await importOriginal<typeof import('@pulls.review/core/github')>(),
  fetchOpenPullRequests: mocks.fetchOpenPullRequests,
}))

function item(number: number): PullRequestListItem {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state: 'open',
    labels: [],
    assignees: [],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    comments: 0,
  }
}

function page(numbers: number[], totalCount: number, next?: string): PullRequestListPage {
  return { totalCount, items: numbers.map(item), next }
}

/** `github:{owner}/{repo}#{number}` back to its ref, for seeding entries by cache key. */
function parseKey(key: string) {
  const [, owner = '', repo = '', number = ''] = key.match(/^github:([^/]+)\/([^#]+)#(\d+)$/) ?? []
  return { kind: 'github-pr' as const, owner, repo, number }
}

function viewedEntry(key: string, analyzedBy: PrCacheEntry['analyzedBy'] = {}): PrCacheEntry {
  return {
    key,
    headSha: 'head',
    analyzedBy,
    lastViewedAt: 0,
    sizeBytes: 0,
    diff: {
      ref: parseKey(key),
      title: 't',
      description: '',
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2, isBinary: false, sha: 'a', hunks: [] },
        { path: 'docs/b.md', status: 'added', additions: 5, deletions: 0, isBinary: false, sha: 'b', hunks: [] },
      ],
    },
  }
}

beforeEach(() => {
  storage = createStorage({ driver: memoryDriver() })
  cache = createCacheRepositories(storage)
  for (const mock of Object.values(mocks))
    mock.mockReset()
  mocks.resolveGitlabNamespace.mockResolvedValue('project')
  mocks.fetchGitlabLabelNames.mockResolvedValue(['bug'])
})

describe('createPullRequestListStore', () => {
  it('fetches the first page, exposes it and caches it', async () => {
    mocks.fetchOpenPullRequests.mockResolvedValue(page([3, 2, 1], 3))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials('tok') })

    await store.load()

    const [client, owner, repo] = mocks.fetchOpenPullRequests.mock.calls[0]!
    expect([await client.token(), owner, repo]).toEqual(['tok', 'o', 'r'])
    expect(store.items.map(pr => pr.number)).toEqual([3, 2, 1])
    expect(store.totalCount).toBe(3)
    expect(store.hasMore).toBe(false)
    expect(store.isLoading).toBe(false)
    expect(await storage.getItem('pulls:o/r')).toMatchObject({ owner: 'o', repo: 'r', page: { totalCount: 3, items: page([3, 2, 1], 3).items } })
  })

  it('shows the cached page while the fresh one loads, then replaces it', async () => {
    await storage.setItem('pulls:o/r', { owner: 'o', repo: 'r', page: page([5, 4], 2), lastViewedAt: 0 })
    const { promise, resolve: resolveFetch } = Promise.withResolvers<PullRequestListPage>()
    mocks.fetchOpenPullRequests.mockReturnValue(promise)
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })

    const loading = store.load()
    await vi.waitFor(() => expect(store.items.map(pr => pr.number)).toEqual([5, 4]))
    expect(store.isLoading).toBe(false)
    expect(store.isRefreshing).toBe(true)

    resolveFetch(page([6, 5, 4], 3))
    await loading

    expect(store.items.map(pr => pr.number)).toEqual([6, 5, 4])
    expect(store.isRefreshing).toBe(false)
  })

  it('appends subsequent pages through the continuation and drains them all on loadAll', async () => {
    mocks.fetchOpenPullRequests
      .mockResolvedValueOnce(page([9, 8], 5, 'p2'))
      .mockResolvedValueOnce(page([7, 6], 5, 'p3'))
      .mockResolvedValueOnce(page([5], 5))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })

    await store.load()
    expect(store.hasMore).toBe(true)

    await store.loadAll()

    expect(mocks.fetchOpenPullRequests.mock.calls.map(call => call[3])).toEqual([undefined, 'p2', 'p3'])
    expect(store.items.map(pr => pr.number)).toEqual([9, 8, 7, 6, 5])
    expect(store.hasMore).toBe(false)
    // Only the first page is persisted.
    expect(await storage.getItem('pulls:o/r')).toMatchObject({ page: page([9, 8], 5, 'p2') })
  })

  it('surfaces a failed first load as an error and keeps cached rows visible', async () => {
    await storage.setItem('pulls:o/r', { owner: 'o', repo: 'r', page: page([1], 1), lastViewedAt: 0 })
    mocks.fetchOpenPullRequests.mockRejectedValue(new Error('rate limited'))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })

    await store.load()

    expect(store.error?.message).toBe('rate limited')
    expect(store.items.map(pr => pr.number)).toEqual([1])
  })

  it('decorates rows with what this browser already viewed: diff size, group count, AI availability', async () => {
    await cache.diffs.put(viewedEntry('github:o/r#1'))
    const aiGroups = [{ key: 'g1', label: 'One', filePaths: ['src/a.ts', 'docs/b.md'] }]
    await cache.diffs.put(viewedEntry('github:o/r#2', { llm: { source: 'llm', schemaVersion: 1, generatedAt: '', groups: aiGroups } }))
    await cache.diffs.put(viewedEntry('github:other/r#3'))
    mocks.fetchOpenPullRequests.mockResolvedValue(page([2, 1], 2))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })

    await store.load()
    await vi.waitFor(() => expect(store.viewed.size).toBe(2))

    // Two rule-based groups (source vs docs) when no AI result is stored.
    expect(store.viewed.get('/gh/o/r/1')).toEqual({ additions: 15, deletions: 2, files: 2, groups: 2, hasAiResult: false })
    expect(store.viewed.get('/gh/o/r/2')).toMatchObject({ groups: 1, hasAiResult: true })
    expect(store.viewed.has('/gh/o/r/3')).toBe(false)
  })

  it('drops a continuation that resolves after a refresh replaced the list', async () => {
    const { promise, resolve: resolveMore } = Promise.withResolvers<PullRequestListPage>()
    mocks.fetchOpenPullRequests
      .mockResolvedValueOnce(page([2, 1], 4, 'p2'))
      .mockReturnValueOnce(promise)
      .mockResolvedValueOnce(page([3, 2], 3))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })
    await store.load()

    const more = store.loadMore()
    await store.refresh()
    resolveMore(page([0], 4))
    await more

    expect(store.items.map(pr => pr.number)).toEqual([3, 2])
    expect(store.hasMore).toBe(false)
  })
})

describe('a GitLab list store', () => {
  const repository = { host: 'self.host', project: 'g/p' }

  it('starts from the given filters, resolves the username once, and refetches the first page when they change', async () => {
    mocks.fetchGitlabUsername.mockResolvedValue('alice')
    mocks.fetchMergeRequests.mockResolvedValueOnce(page([1], 1)).mockResolvedValueOnce(page([9], 1)).mockResolvedValueOnce(page([8], 1))
    const store = createPullRequestListStore(repository, { cache, credentials: staticCredentials(), filters: { state: 'opened', mine: 'author', labels: [], draft: 'any' } })
    await store.load()

    expect(mocks.fetchMergeRequests.mock.calls[0]![2]).toMatchObject({ filters: { mine: 'author' }, username: 'alice', kind: 'project' })
    expect(store.labelOptions).toEqual(['bug'])

    await store.setFilters({ state: 'merged', mine: 'reviewer', labels: ['bug'], draft: 'hide', targetBranch: 'main' })
    await store.setFilters({ state: 'all', labels: [], draft: 'any' })

    expect(mocks.fetchMergeRequests.mock.calls[1]![2]).toMatchObject({ filters: { state: 'merged', mine: 'reviewer' }, username: 'alice', next: undefined })
    expect(mocks.fetchMergeRequests.mock.calls[2]![2]).toMatchObject({ filters: { state: 'all' }, username: undefined })
    expect(mocks.fetchGitlabUsername).toHaveBeenCalledOnce()
    expect(store.items.map(pr => pr.number)).toEqual([8])
    expect(store.filters).toMatchObject({ state: 'all' })
  })

  it('never lets a slower response for the previous filters overwrite the new list', async () => {
    const stale = Promise.withResolvers<PullRequestListPage>()
    mocks.fetchMergeRequests.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page([2], 1))
    const store = createPullRequestListStore(repository, { cache, credentials: staticCredentials() })

    const first = store.load()
    await vi.waitFor(() => expect(mocks.fetchMergeRequests).toHaveBeenCalledOnce())
    await store.setFilters({ state: 'closed', labels: [], draft: 'any' })
    stale.resolve(page([1], 1))
    await first

    expect(store.items.map(pr => pr.number)).toEqual([2])
    expect(store.isLoading).toBe(false)
  })

  it('has no filters on a GitHub list', async () => {
    mocks.fetchOpenPullRequests.mockResolvedValue(page([1], 1))
    const store = createPullRequestListStore({ owner: 'o', repo: 'r' }, { cache, credentials: staticCredentials() })
    await store.load()
    expect(store.filters).toBeUndefined()
    expect(mocks.fetchGitlabLabelNames).not.toHaveBeenCalled()
  })
})
