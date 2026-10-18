import type { Commit } from '../../types/diff'
import type { GitlabClient } from './client'
import { GitlabApiError, projectPath } from './client'

export interface GitlabMergeRequestJson {
  title: string
  description: string | null
  author: { username: string, avatar_url?: string | null } | null
  source_branch: string
  target_branch: string
  sha: string
  diff_refs: { base_sha: string, head_sha: string, start_sha: string } | null
  created_at: string
  updated_at: string
  web_url: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft?: boolean
  work_in_progress?: boolean
}

/** One file of a merge request, compare or commit diff; `diff` holds hunks only, no file headers. */
export interface GitlabDiffJson {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
  /** Set when GitLab dropped `diff` for size. */
  too_large?: boolean
  collapsed?: boolean
}

export interface GitlabCommitJson {
  id: string
  message: string
  author_name?: string
  authored_date?: string
  parent_ids?: string[]
  web_url?: string
}

export function toCommit({ id, message, author_name, authored_date }: GitlabCommitJson): Commit {
  // `''`: GitLab names aren't GitHub logins, so no avatar may be looked up by name.
  return { sha: id, message, author: author_name ? { name: author_name, avatarUrl: '' } : undefined, date: authored_date }
}

export async function fetchMergeRequest(client: GitlabClient, project: string, iid: string): Promise<GitlabMergeRequestJson> {
  return (await client.request(`${projectPath(project)}/merge_requests/${iid}`)).json()
}

/** Needs GitLab 15.7+, which added the paginated `/diffs` endpoint. */
export function fetchMergeRequestDiffs(client: GitlabClient, project: string, iid: string): Promise<GitlabDiffJson[]> {
  return client.paginate(`${projectPath(project)}/merge_requests/${iid}/diffs`)
}

/** GitLab lists these newest first. */
export function fetchMergeRequestCommits(client: GitlabClient, project: string, iid: string): Promise<GitlabCommitJson[]> {
  return client.paginate(`${projectPath(project)}/merge_requests/${iid}/commits`)
}

export interface GitlabCompareJson {
  commits: GitlabCommitJson[]
  diffs: GitlabDiffJson[]
  web_url?: string
}

/** `base...head` against their merge base (`straight=false`), as GitLab's compare page shows it. */
export async function fetchCompare(client: GitlabClient, project: string, base: string, head: string): Promise<GitlabCompareJson> {
  const query = `from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}&straight=false`
  return (await client.request(`${projectPath(project)}/repository/compare?${query}`)).json()
}

export async function fetchMergeBase(client: GitlabClient, project: string, base: string, head: string): Promise<string> {
  const query = `refs[]=${encodeURIComponent(base)}&refs[]=${encodeURIComponent(head)}`
  return ((await (await client.request(`${projectPath(project)}/repository/merge_base?${query}`)).json()) as GitlabCommitJson).id
}

/** A commit, or the commit a branch or tag points at. */
export async function fetchCommit(client: GitlabClient, project: string, ref: string): Promise<GitlabCommitJson> {
  return (await client.request(`${projectPath(project)}/repository/commits/${encodeURIComponent(ref)}`)).json()
}

export function fetchCommitDiffs(client: GitlabClient, project: string, sha: string): Promise<GitlabDiffJson[]> {
  return client.paginate(`${projectPath(project)}/repository/commits/${encodeURIComponent(sha)}/diff`)
}

/** `undefined` when the file doesn't exist at `ref` - expected for one side of an add or delete. */
export async function fetchFileContentAtRef(client: GitlabClient, project: string, path: string, ref: string): Promise<string | undefined> {
  try {
    return await (await client.request(`${projectPath(project)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`)).text()
  }
  catch (err) {
    if (err instanceof GitlabApiError && err.status === 404)
      return undefined
    throw err
  }
}
