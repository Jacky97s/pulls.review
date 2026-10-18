import { afterEach, describe, expect, it, vi } from 'vitest'
import { serializeRef, staticCredentials } from '../../types/source'
import { createGitlabMergeRequestSource } from './index'

const mr = {
  title: 'Add thing',
  description: 'body',
  author: { username: 'alice', avatar_url: 'https://a/av.png' },
  source_branch: 'feat',
  target_branch: 'main',
  sha: 'head1',
  diff_refs: { base_sha: 'base1', head_sha: 'head1', start_sha: 'start1' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  web_url: 'https://self.host/g/p/-/merge_requests/5',
  state: 'opened',
  draft: true,
}

const diffs = [
  { old_path: 'a.ts', new_path: 'a.ts', new_file: false, renamed_file: false, deleted_file: false, diff: '@@ -1,2 +1,2 @@\n-old\n+new\n same\n' },
  { old_path: 'old.ts', new_path: 'new.ts', new_file: false, renamed_file: true, deleted_file: false, diff: '' },
  { old_path: 'img.png', new_path: 'img.png', new_file: true, renamed_file: false, deleted_file: false, diff: 'Binary files /dev/null and b/img.png differ\n' },
  { old_path: 'big.ts', new_path: 'big.ts', new_file: false, renamed_file: false, deleted_file: false, diff: '', too_large: true },
]

const commits = [
  { id: 'c2', message: 'second', author_name: 'alice', authored_date: '2026-01-02' },
  { id: 'c1', message: 'first', author_name: 'alice', authored_date: '2026-01-01' },
]

function respond(url: string): Response {
  const path = new URL(url).pathname + new URL(url).search
  if (path.includes('/repository/files/big.ts/raw'))
    return new Response(path.includes('ref=base1') ? 'x\n' : 'y\n')
  const json = path.endsWith('/merge_requests/5')
    ? mr
    : path.includes('/merge_requests/5/diffs')
      ? diffs
      : path.includes('/merge_requests/5/commits') ? commits : undefined
  return json ? Response.json(json) : new Response('{"message":"404 Not found"}', { status: 404 })
}

describe('createGitlabMergeRequestSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches and normalizes a self-hosted merge request with that host\'s token', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => respond(url))
    vi.stubGlobal('fetch', fetchMock)
    const ref = { host: 'self.host', project: 'g/p', iid: '5' }

    const source = createGitlabMergeRequestSource(ref, staticCredentials('gh', { 'self.host': 'glpat-x', 'gitlab.com': 'wrong' }))
    const payload = await source.fetch()

    expect(await source.key()).toBe(serializeRef({ kind: 'gitlab-mr', ...ref }))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://self.host/api/v4/projects/g%2Fp/merge_requests/5')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer glpat-x')

    expect(payload).toMatchObject({
      ref: { kind: 'gitlab-mr', ...ref },
      label: '!5',
      author: { name: 'alice', avatarUrl: 'https://a/av.png' },
      base: { sha: 'base1', ref: 'main' },
      head: { sha: 'head1', ref: 'feat' },
      pullRequest: { state: 'draft' },
    })
    expect(payload.commits!.map(c => c.sha)).toEqual(['c1', 'c2'])
    // A GitLab author name is not a GitHub login: never left for the app to look up there.
    expect(payload.commits![0]!.author).toEqual({ name: 'alice', avatarUrl: '' })
    const [modified, renamed, binary, big] = payload.files
    expect(modified).toMatchObject({ path: 'a.ts', status: 'modified', additions: 1, deletions: 1, isBinary: false })
    expect(renamed).toMatchObject({ path: 'new.ts', previousPath: 'old.ts', status: 'renamed', hunks: [] })
    expect(binary).toMatchObject({ status: 'added', isBinary: true, hunks: [] })
    expect(big).toMatchObject({ path: 'big.ts', truncated: true, hunks: [] })
    // Dropped diffs are loaded on demand, never all at once while the diff opens.
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/repository/files/'))).toBe(false)
  })

  it('keeps a file\'s sha across pushes that leave its diff alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => respond(url)))
    const first = await createGitlabMergeRequestSource({ host: 'self.host', project: 'g/p', iid: '5' }).fetch()
    mr.diff_refs.head_sha = 'head2'
    const second = await createGitlabMergeRequestSource({ host: 'self.host', project: 'g/p', iid: '5' }).fetch()
    expect(second.files[0]!.sha).toBe(first.files[0]!.sha)
    expect(second.files[3]!.sha).not.toBe(first.files[3]!.sha)
  })
})

describe('gitlab client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('names the host when a request never gets a response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(createGitlabMergeRequestSource({ host: 'self.host', project: 'g/p', iid: '1' }).fetch()).rejects.toThrow(/self\.host.*CORS/)
  })
})
