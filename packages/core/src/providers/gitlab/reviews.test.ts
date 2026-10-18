import type { FileChange } from '../../types/diff'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePatch } from '../../patch-parser'
import { staticCredentials } from '../../types/source'
import { createGitlabClient } from './client'
import { createGitlabReviewsApi, fetchGitlabViewer, normalizeGitlabReviews } from './reviews'

const mr = {
  web_url: 'https://self.host/g/p/-/merge_requests/5',
  sha: 'head1',
  diff_refs: { base_sha: 'base1', start_sha: 'start1', head_sha: 'head1' },
}

const alice = { username: 'alice', avatar_url: null }

function note(id: number, extra: object = {}) {
  return { id, type: 'DiffNote', body: `note ${id}`, author: alice, created_at: '2026-10-01T00:00:00Z', system: false, ...extra }
}

const position = { head_sha: 'head1', old_path: 'a.ts', new_path: 'a.ts', old_line: null, new_line: 4 }

describe('normalizeGitlabReviews', () => {
  it('threads diff discussions, skipping system notes and overview comments', () => {
    const data = normalizeGitlabReviews({
      mr,
      discussions: [
        { id: 'd1', notes: [note(1, { position, resolvable: true, resolved: false }), note(2, { system: true }), note(3)] },
        { id: 'd2', notes: [{ ...note(4), type: null }] },
      ],
      drafts: [],
      reviewers: [],
    })
    expect(data.threads).toHaveLength(1)
    expect(data.threads[0]).toMatchObject({ rootId: 1, threadId: 'd1', path: 'a.ts', side: 'additions', line: 4, outdated: false, resolved: false, pending: false })
    expect(data.threads[0]!.comments.map(c => c.id)).toEqual([1, 3])
    expect(data.threads[0]!.comments[0]).toMatchObject({ url: 'https://self.host/g/p/-/merge_requests/5#note_1', author: { login: 'alice', avatarUrl: '' } })
    expect(data.pendingReview).toBeUndefined()
  })

  it('marks a thread anchored on an older head as outdated', () => {
    const data = normalizeGitlabReviews({ mr, discussions: [{ id: 'd1', notes: [note(1, { position: { ...position, head_sha: 'old' } })] }], drafts: [], reviewers: [] })
    expect(data.threads[0]).toMatchObject({ outdated: true, line: undefined })
  })

  it('shows the viewer\'s draft notes as a pending review, with negative ids', () => {
    const data = normalizeGitlabReviews({
      mr,
      discussions: [{ id: 'd1', notes: [note(1, { position })] }],
      drafts: [
        { id: 7, discussion_id: null, note: 'new thread', position: { ...position, new_line: 9 } },
        { id: 8, discussion_id: 'd1', note: 'draft reply', position: null },
      ],
      reviewers: [],
      viewer: { login: 'me', avatarUrl: '' },
    })
    expect(data.pendingReview).toBeDefined()
    expect(data.threads[0]!.comments.at(-1)).toMatchObject({ id: -8, pending: true, body: 'draft reply' })
    expect(data.threads[1]).toMatchObject({ rootId: -7, line: 9, pending: true, comments: [{ id: -7, author: { login: 'me' } }] })
  })

  it('reports approvals and requested changes as review summaries', () => {
    const data = normalizeGitlabReviews({
      mr,
      discussions: [],
      drafts: [],
      reviewers: [{ user: alice, state: 'approved' }, { user: { username: 'bob' }, state: 'requested_changes' }, { user: { username: 'cy' }, state: 'unreviewed' }],
    })
    expect(data.summaries.map(s => [s.author?.login, s.state])).toEqual([['alice', 'approved'], ['bob', 'changes_requested']])
  })
})

describe('gitlab review writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function setup() {
    const calls: { method: string, path: string, body?: any }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace('/api/v4/projects/g%2Fp/merge_requests/5', '')
      calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '' && (init?.method ?? 'GET') === 'GET')
        return Response.json(mr)
      if (path === '/discussions' && (init?.method ?? 'GET') === 'GET')
        return Response.json([{ id: 'd1', notes: [note(1, { position })] }])
      if (path === '/draft_notes' && (init?.method ?? 'GET') === 'GET')
        return Response.json([{ id: 7, discussion_id: null, note: 'x', position }, { id: 8, discussion_id: null, note: 'y', position }])
      return Response.json({})
    }))
    const files: FileChange[] = await parsePatch('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,3 +2,4 @@\n two\n-three\n+three a\n+three b\n four\n')
    const api = createGitlabReviewsApi(createGitlabClient('self.host', staticCredentials(undefined, { 'self.host': 't' })), { project: 'g/p', iid: '5' }, { files: async () => files })
    const writes = () => calls.filter(call => call.method !== 'GET')
    return { api, writes }
  }

  it('posts a comment on an unchanged line with both line numbers', async () => {
    const { api, writes } = await setup()
    await api.addComment({ target: { path: 'a.ts', side: 'additions', line: 5 }, body: 'hi', mode: 'single', headSha: 'head1' })
    expect(writes()).toEqual([{
      method: 'POST',
      path: '/discussions',
      body: { body: 'hi', position: { position_type: 'text', base_sha: 'base1', start_sha: 'start1', head_sha: 'head1', old_path: 'a.ts', new_path: 'a.ts', old_line: 4, new_line: 5 } },
    }])
  })

  it('starts a review as a draft note, and anchors a range by line codes', async () => {
    const { api, writes } = await setup()
    await api.addComment({ target: { path: 'a.ts', side: 'additions', line: 4, startLine: 3, startSide: 'additions' }, body: 'hi', mode: 'review', headSha: 'head1' })
    const [call] = writes()
    expect(call).toMatchObject({ method: 'POST', path: '/draft_notes', body: { note: 'hi', position: { new_line: 4 } } })
    expect(call!.body.position.line_range).toEqual({
      start: { line_code: expect.stringMatching(/^[0-9a-f]{40}_4_3$/), type: 'new', new_line: 3 },
      end: { line_code: expect.stringMatching(/^[0-9a-f]{40}_4_4$/), type: 'new', new_line: 4 },
    })
  })

  it('replies into the discussion, and refuses a reply to an unpublished draft', async () => {
    const { api, writes } = await setup()
    await api.fetch()
    await api.reply(1, 'thanks')
    expect(writes()).toEqual([{ method: 'POST', path: '/discussions/d1/notes', body: { body: 'thanks' } }])
    await expect(api.reply(-7, 'nope')).rejects.toThrow(/Submit your review/)
  })

  it('edits and deletes drafts and notes at their own endpoints', async () => {
    const { api, writes } = await setup()
    await api.editComment(-7, 'a')
    await api.editComment(3, 'b')
    await api.deleteComment(-7)
    await api.deleteComment(3)
    expect(writes()).toEqual([
      { method: 'PUT', path: '/draft_notes/7', body: { note: 'a' } },
      { method: 'PUT', path: '/notes/3', body: { body: 'b' } },
      { method: 'DELETE', path: '/draft_notes/7' },
      { method: 'DELETE', path: '/notes/3' },
    ])
  })

  it('submits drafts with the verdict, approving formally', async () => {
    const { api, writes } = await setup()
    await api.submitReview('APPROVE', 'lgtm', { id: 0 })
    await api.submitReview('REQUEST_CHANGES', 'fix', undefined)
    await api.submitReview('COMMENT', 'just a note', undefined)
    expect(writes()).toEqual([
      { method: 'POST', path: '/draft_notes/bulk_publish', body: { note: 'lgtm' } },
      { method: 'POST', path: '/approve', body: {} },
      { method: 'POST', path: '/draft_notes/bulk_publish', body: { note: 'fix', reviewer_state: 'requested_changes' } },
      { method: 'POST', path: '/notes', body: { body: 'just a note' } },
    ])
  })

  it('discards every draft note', async () => {
    const { api, writes } = await setup()
    await api.discardPendingReview({ id: 0 })
    expect(writes()).toEqual([{ method: 'DELETE', path: '/draft_notes/7' }, { method: 'DELETE', path: '/draft_notes/8' }])
  })

  it('resolves a thread by its discussion', async () => {
    const { api, writes } = await setup()
    await api.resolveThread('d1')
    expect(writes()).toEqual([{ method: 'PUT', path: '/discussions/d1', body: { resolved: true } }])
  })

  it('turns a refused write into writeForbidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: '403 Forbidden' }, { status: 403 })))
    const api = createGitlabReviewsApi(createGitlabClient('self.host'), { project: 'g/p', iid: '5' }, { files: async () => [] })
    await expect(api.deleteComment(3)).rejects.toMatchObject({ code: expect.stringMatching(/write/i) })
  })
})

describe('fetchGitlabViewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stub(scopes: { pat?: string[], oauth?: string[] }) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/v4/user'))
        return Response.json({ username: 'me' })
      if (url.endsWith('/personal_access_tokens/self'))
        return scopes.pat ? Response.json({ scopes: scopes.pat }) : Response.json({}, { status: 401 })
      if (url.endsWith('/oauth/token/info'))
        return scopes.oauth ? Response.json({ scope: scopes.oauth }) : Response.json({}, { status: 401 })
      return Response.json({}, { status: 404 })
    }))
  }
  const client = () => createGitlabClient('self.host', staticCredentials(undefined, { 'self.host': 't' }))

  it('may write with an api-scoped personal access token', async () => {
    stub({ pat: ['api'] })
    expect(await fetchGitlabViewer(client())).toEqual({ login: 'me', canWrite: true })
  })

  it('may not write with a read_api OAuth token', async () => {
    stub({ oauth: ['read_api'] })
    expect(await fetchGitlabViewer(client())).toEqual({ login: 'me', canWrite: false })
  })

  it('is anonymous without a token', async () => {
    expect(await fetchGitlabViewer(createGitlabClient('self.host'))).toBeUndefined()
  })
})
