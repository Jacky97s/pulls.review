import type { DiffsPayload, FileChange, FileChangeStatus, PullRequestState } from '../../types/diff'
import type { GitlabCommitJson, GitlabDiffJson, GitlabMergeRequestJson } from './api'
import { computeContentHash, countChanges, parseHunks } from '../../patch-parser'
import { toCommit } from './api'

/** The two commits a diff compares; `base` is absent for a root commit. */
export interface ComparedShas {
  base?: string
  head: string
}

function statusOf(file: GitlabDiffJson): FileChangeStatus {
  if (file.new_file)
    return 'added'
  if (file.deleted_file)
    return 'removed'
  if (file.renamed_file)
    return 'renamed'
  return 'modified'
}

async function normalizeFile(file: GitlabDiffJson, shas: ComparedShas): Promise<FileChange> {
  const status = statusOf(file)
  // GitLab reports binary files as a `Binary files ... differ` line instead of hunks.
  const isBinary = file.diff.startsWith('Binary files ')
  // A dropped diff loads on demand: rebuilding every one up front is a request per file,
  // which a large compare turns into a rate limit.
  const truncated = !file.diff && !!(file.too_large || file.collapsed)
  const hunks = isBinary || truncated ? [] : parseHunks(file.diff.split('\n'))
  // GitLab lists no blob sha, so a file's version is keyed by its diff - stable across pushes that leave it alone.
  // A dropped diff has no content to key by, so it changes with the head.
  const sha = await computeContentHash(truncated ? `${shas.head}:${file.new_path}` : `${file.new_path}\n${file.diff}`)
  return {
    path: file.new_path,
    previousPath: status === 'renamed' ? file.old_path : undefined,
    status,
    ...countChanges(hunks),
    isBinary,
    sha,
    hunks,
    ...(truncated && { truncated: true as const }),
  }
}

export function normalizeFiles(files: GitlabDiffJson[], shas: ComparedShas): Promise<FileChange[]> {
  return Promise.all(files.map(file => normalizeFile(file, shas)))
}

function resolveState(mr: GitlabMergeRequestJson): PullRequestState {
  if (mr.state === 'merged')
    return 'merged'
  if (mr.state === 'closed' || mr.state === 'locked')
    return 'closed'
  if (mr.draft ?? mr.work_in_progress)
    return 'draft'
  return 'open'
}

export async function normalizeMergeRequest(
  { host, project, iid }: { host: string, project: string, iid: string },
  mr: GitlabMergeRequestJson,
  diffs: GitlabDiffJson[],
  commits: GitlabCommitJson[],
): Promise<DiffsPayload> {
  const baseSha = mr.diff_refs?.base_sha ?? mr.sha
  const headSha = mr.diff_refs?.head_sha ?? mr.sha
  return {
    ref: { kind: 'gitlab-mr', host, project, iid },
    title: mr.title,
    label: `!${iid}`,
    author: mr.author ? { name: mr.author.username, avatarUrl: mr.author.avatar_url ?? '' } : undefined,
    description: mr.description ?? '',
    url: mr.web_url,
    base: { sha: baseSha, ref: mr.target_branch },
    head: { sha: headSha, ref: mr.source_branch },
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    pullRequest: { state: resolveState(mr) },
    commits: commits.map(toCommit).reverse(),
    files: await normalizeFiles(diffs, { base: baseSha, head: headSha }),
  }
}
