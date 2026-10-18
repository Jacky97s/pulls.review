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

function normalizeItem(mr: GitlabListMergeRequestJson, inGroup: boolean): PullRequestListItem {
  const repository = inGroup ? mr.references?.full?.replace(/!\d+$/, '') : undefined
  return {
    number: mr.iid,
    ...(repository && { repository }),
    title: mr.title,
    url: mr.web_url,
    state: (mr.draft ?? mr.work_in_progress) ? 'draft' : 'open',
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

/**
 * Open merge requests of a project, or of a group and all its subgroups, newest activity
 * first; `next` is the next page number. A group's items name their own project.
 */
export async function fetchOpenMergeRequests(client: GitlabClient, path: string, next?: string, kind: GitlabNamespaceKind = 'project'): Promise<PullRequestListPage> {
  const page = next ? Number(next) : 1
  const params = new URLSearchParams({
    state: 'opened',
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
