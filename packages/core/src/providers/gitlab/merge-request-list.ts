import type { PullRequestListItem, PullRequestListPage } from '../../types/pull-request-list'
import type { GitlabClient } from './client'
import { GitlabApiError, projectPath } from './client'

const PAGE_SIZE = 100

interface GitlabUserJson {
  username: string
  avatar_url?: string | null
}

interface GitlabListMergeRequestJson {
  iid: number
  /** `group/project!12`; names the item's own project in a group's list. */
  references?: { full?: string }
  title: string
  web_url: string
  state?: string
  draft?: boolean
  work_in_progress?: boolean
  author: GitlabUserJson | null
  labels: { name: string, color: string, description: string | null }[]
  assignees?: GitlabUserJson[] | null
  milestone: { title: string } | null
  user_notes_count: number
  created_at: string
  updated_at: string
}

function normalizeUser(user: GitlabUserJson): NonNullable<PullRequestListItem['author']> {
  // `''` rather than absent: the app would otherwise look the username up on github.com.
  return { login: user.username, avatarUrl: user.avatar_url ?? '' }
}

function normalizeState(mr: GitlabListMergeRequestJson): PullRequestListItem['state'] {
  if (mr.state === 'merged' || mr.state === 'closed')
    return mr.state
  return (mr.draft ?? mr.work_in_progress) ? 'draft' : 'open'
}

function normalizeItem(mr: GitlabListMergeRequestJson, inGroup: boolean): PullRequestListItem {
  const repository = inGroup ? mr.references?.full?.replace(/!\d+$/, '') : undefined
  return {
    number: mr.iid,
    ...(repository && { repository }),
    title: mr.title,
    url: mr.web_url,
    state: normalizeState(mr),
    author: mr.author ? normalizeUser(mr.author) : undefined,
    // GitLab colors carry their `#`; the list stores bare hex, as GitHub returns it.
    labels: mr.labels.map(label => ({ name: label.name, color: label.color.replace(/^#/, ''), description: label.description ?? undefined })),
    assignees: (mr.assignees ?? []).map(normalizeUser),
    milestone: mr.milestone?.title,
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    comments: mr.user_notes_count,
  }
}

/** A path names a project or a group, and only GitLab can tell which. */
export type GitlabNamespaceKind = 'project' | 'group'

export const GITLAB_MR_STATES = ['opened', 'merged', 'closed', 'all'] as const
/** The relation between the token's user and a merge request that "mine" filters on. */
export const GITLAB_MR_MINE = ['author', 'assignee', 'reviewer'] as const
export const GITLAB_MR_DRAFT = ['any', 'only', 'hide'] as const

/** What the merge request list narrows to; each field maps to one server-side query parameter. */
export interface GitlabMergeRequestFilters {
  state: typeof GITLAB_MR_STATES[number]
  mine?: typeof GITLAB_MR_MINE[number]
  labels: string[]
  draft: typeof GITLAB_MR_DRAFT[number]
  targetBranch?: string
}

export const DEFAULT_GITLAB_MR_FILTERS: GitlabMergeRequestFilters = { state: 'opened', labels: [], draft: 'any' }

const MINE_PARAM = { author: 'author_username', assignee: 'assignee_username', reviewer: 'reviewer_username' } as const
const DRAFT_PARAM = { any: undefined, only: 'yes', hide: 'no' } as const

/** The query parameters `filters` stands for; `username` is the token's user, which `mine` needs. */
export function toGitlabParams(filters: GitlabMergeRequestFilters, username?: string): Record<string, string> {
  const params: Record<string, string | undefined> = {
    state: filters.state,
    labels: filters.labels.length ? filters.labels.join(',') : undefined,
    wip: DRAFT_PARAM[filters.draft],
    target_branch: filters.targetBranch || undefined,
  }
  if (filters.mine) {
    if (!username)
      throw new Error('Filtering on "mine" needs the current GitLab user; sign in with a token first.')
    params[MINE_PARAM[filters.mine]] = username
  }
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

export interface GitlabMergeRequestListOptions {
  filters?: GitlabMergeRequestFilters
  /** The token's user, required when `filters.mine` is set. */
  username?: string
  next?: string
  kind?: GitlabNamespaceKind
}

/**
 * Merge requests of a project, or of a group and all its subgroups, narrowed by `filters`
 * (open ones by default), newest activity first; `next` is the next page number. A group's
 * items name their own project.
 */
export async function fetchMergeRequests(client: GitlabClient, path: string, { filters = DEFAULT_GITLAB_MR_FILTERS, username, next, kind = 'project' }: GitlabMergeRequestListOptions = {}): Promise<PullRequestListPage> {
  const page = next ? Number(next) : 1
  const params = new URLSearchParams({
    ...toGitlabParams(filters, username),
    order_by: 'updated_at',
    sort: 'desc',
    with_labels_details: 'true',
    per_page: String(PAGE_SIZE),
    page: String(page),
  })
  const base = kind === 'group' ? `/groups/${encodeURIComponent(path)}` : projectPath(path)
  const res = await client.request(`${base}/merge_requests?${params}`)
  const items: GitlabListMergeRequestJson[] = await res.json()
  // GitLab omits `X-Total` past 10,000 results; fall back to a lower bound from the pages seen.
  const total = Number(res.headers.get('x-total'))
  const nextPage = res.headers.get('x-next-page')
  return {
    totalCount: Number.isFinite(total) && res.headers.has('x-total') ? total : (page - 1) * PAGE_SIZE + items.length,
    items: items.map(item => normalizeItem(item, kind === 'group')),
    next: nextPage || undefined,
  }
}

/** The token's own username, what GitLab's `*_username` filters take for "me". */
export async function fetchGitlabUsername(client: GitlabClient): Promise<string> {
  return ((await (await client.request('/user')).json()) as GitlabUserJson).username
}

/** Labels a merge request in the project, or in the group and its subgroups, can carry. */
export async function fetchGitlabLabelNames(client: GitlabClient, path: string, kind: GitlabNamespaceKind): Promise<string[]> {
  const url = kind === 'group' ? `/groups/${encodeURIComponent(path)}/labels?include_descendant_groups=true` : `${projectPath(path)}/labels`
  const labels = await client.paginate<{ name: string }>(url)
  return labels.map(label => label.name)
}

/** Whether `path` is a project or a group: a project when GitLab finds one there, else a group. */
export async function resolveGitlabNamespace(client: GitlabClient, path: string): Promise<GitlabNamespaceKind> {
  try {
    await client.request(projectPath(path))
    return 'project'
  }
  catch (err) {
    if (err instanceof GitlabApiError && err.status === 404)
      return 'group'
    throw err
  }
}
