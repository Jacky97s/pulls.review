import type { DiffsPayload, FileChange } from '../../types/diff'
import type { Credentials, DiffSource, SourceRef } from '../../types/source'
import { serializeRef } from '../../types/source'
import { fetchCommit, fetchCommitDiffs, fetchCompare, fetchFileContentAtRef, fetchMergeBase, fetchMergeRequest, fetchMergeRequestCommits, fetchMergeRequestDiffs, toCommit } from './api'
import { createGitlabClient } from './client'
import { normalizeFiles, normalizeMergeRequest } from './normalize'
import { createGitlabReviewsApi, fetchGitlabViewer } from './reviews'
import { createGitlabSharingApi } from './sharing'

export interface GitlabSourceOptions {
  /** Where shared-analysis notes link to: the deployment readers open (default pulls.review). */
  siteOrigin?: string
}

export function createGitlabMergeRequestSource(ref: { host: string, project: string, iid: string }, credentials?: Credentials, { siteOrigin = 'https://pulls.review' }: GitlabSourceOptions = {}): DiffSource {
  const { host, project, iid } = ref
  const client = createGitlabClient(host, credentials)
  const key = serializeRef({ kind: 'gitlab-mr', host, project, iid })
  const loadFile = (path: string, sha: string) => fetchFileContentAtRef(client, project, path, sha)
  // Comment positions need the hunks; the diff a reader comments on is the one last fetched.
  let files: Promise<FileChange[]> | undefined
  const fetchPayload = async () => {
    const [mr, diffs, commits] = await Promise.all([
      fetchMergeRequest(client, project, iid),
      fetchMergeRequestDiffs(client, project, iid),
      fetchMergeRequestCommits(client, project, iid),
    ])
    return normalizeMergeRequest({ host, project, iid }, mr, diffs, commits)
  }
  return {
    key: async () => key,
    async fetch() {
      const payload = fetchPayload()
      files = payload.then(diff => diff.files)
      return payload
    },
    fingerprint: async () => (await fetchMergeRequest(client, project, iid)).sha,
    loadFile,
    viewer: () => fetchGitlabViewer(client),
    reviews: createGitlabReviewsApi(client, { project, iid }, { files: () => files ?? (files = fetchPayload().then(diff => diff.files)) }),
    sharing: createGitlabSharingApi(client, { host, project, iid }, siteOrigin),
    auth: 'gitlab-token',
  }
}

/** What `head` adds since it forked from `base`, the diff GitLab shows at `/-/compare/base...head`. */
export function createGitlabCompareSource({ host, project, base, head }: { host: string, project: string, base: string, head: string }, credentials?: Credentials): DiffSource {
  const client = createGitlabClient(host, credentials)
  const key = serializeRef({ kind: 'gitlab-compare', host, project, base, head })
  const loadFile = (path: string, sha: string) => fetchFileContentAtRef(client, project, path, sha)
  return {
    key: async () => key,
    async fetch(): Promise<DiffsPayload> {
      const [compare, baseSha, headCommit] = await Promise.all([
        fetchCompare(client, project, base, head),
        fetchMergeBase(client, project, base, head),
        fetchCommit(client, project, head),
      ])
      return {
        ref: { kind: 'gitlab-compare', host, project, base, head },
        title: `${base}...${head}`,
        url: compare.web_url,
        base: { sha: baseSha, ref: base },
        head: { sha: headCommit.id, ref: head },
        commits: compare.commits.map(toCommit),
        files: await normalizeFiles(compare.diffs, { base: baseSha, head: headCommit.id }),
      }
    },
    fingerprint: async () => (await fetchCommit(client, project, head)).id,
    loadFile,
    auth: 'gitlab-token',
  }
}

/** One commit against its first parent. A commit never changes, so it has no staleness check. */
export function createGitlabCommitSource({ host, project, sha }: { host: string, project: string, sha: string }, credentials?: Credentials): DiffSource {
  const client = createGitlabClient(host, credentials)
  const key = serializeRef({ kind: 'gitlab-commit', host, project, sha })
  const loadFile = (path: string, fileSha: string) => fetchFileContentAtRef(client, project, path, fileSha)
  return {
    key: async () => key,
    async fetch(): Promise<DiffsPayload> {
      const [commit, diffs] = await Promise.all([fetchCommit(client, project, sha), fetchCommitDiffs(client, project, sha)])
      const [subject = '', ...body] = commit.message.split('\n')
      const parent = commit.parent_ids?.[0]
      const { author, date } = toCommit(commit)
      return {
        ref: { kind: 'gitlab-commit', host, project, sha },
        title: subject,
        label: commit.id.slice(0, 8),
        description: body.join('\n').trim(),
        url: commit.web_url,
        author,
        createdAt: date,
        base: parent ? { sha: parent, ref: parent.slice(0, 8) } : undefined,
        head: { sha: commit.id, ref: commit.id.slice(0, 8) },
        commits: [toCommit(commit)],
        files: await normalizeFiles(diffs, { base: parent, head: commit.id }),
      }
    },
    loadFile,
    auth: 'gitlab-token',
  }
}

/** Every ref kind GitLab serves. */
export type GitlabRef = Extract<SourceRef, { kind: 'gitlab-mr' | 'gitlab-compare' | 'gitlab-commit' }>

export function createGitlabSource(ref: GitlabRef, credentials?: Credentials, options?: GitlabSourceOptions): DiffSource {
  switch (ref.kind) {
    case 'gitlab-mr':
      return createGitlabMergeRequestSource(ref, credentials, options)
    case 'gitlab-compare':
      return createGitlabCompareSource(ref, credentials)
    case 'gitlab-commit':
      return createGitlabCommitSource(ref, credentials)
  }
}
