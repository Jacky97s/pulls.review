import type { DiffsPayload } from '../../types/diff'
import type { Credentials, DiffSource, SourceRef } from '../../types/source'
import { serializeRef } from '../../types/source'
import { fetchCommit, fetchCommitDiffs, fetchCompare, fetchFileContentAtRef, fetchMergeBase, fetchMergeRequest, fetchMergeRequestCommits, fetchMergeRequestDiffs, toCommit } from './api'
import { createGitlabClient } from './client'
import { normalizeFiles, normalizeMergeRequest } from './normalize'

export function createGitlabMergeRequestSource(ref: { host: string, project: string, iid: string }, credentials?: Credentials): DiffSource {
  const { host, project, iid } = ref
  const client = createGitlabClient(host, credentials)
  const key = serializeRef({ kind: 'gitlab-mr', host, project, iid })
  const loadFile = (path: string, sha: string) => fetchFileContentAtRef(client, project, path, sha)
  return {
    key: async () => key,
    async fetch() {
      const [mr, diffs, commits] = await Promise.all([
        fetchMergeRequest(client, project, iid),
        fetchMergeRequestDiffs(client, project, iid),
        fetchMergeRequestCommits(client, project, iid),
      ])
      return normalizeMergeRequest({ host, project, iid }, mr, diffs, commits)
    },
    fingerprint: async () => (await fetchMergeRequest(client, project, iid)).sha,
    loadFile,
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

export function createGitlabSource(ref: GitlabRef, credentials?: Credentials): DiffSource {
  switch (ref.kind) {
    case 'gitlab-mr':
      return createGitlabMergeRequestSource(ref, credentials)
    case 'gitlab-compare':
      return createGitlabCompareSource(ref, credentials)
    case 'gitlab-commit':
      return createGitlabCommitSource(ref, credentials)
  }
}
