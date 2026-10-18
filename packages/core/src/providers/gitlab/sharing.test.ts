import type { SharedAnalysis } from '../../types/shared-analysis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderSharedAnalysisBody } from '../github/shared-analysis-comment'
import { createGitlabClient } from './client'
import { createGitlabSharingApi } from './sharing'

const analysis: SharedAnalysis = {
  headSha: 'head1',
  result: { source: 'llm', generatedAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1, overallSummary: 'x', groups: [{ key: 'a', label: 'A', category: 'core', filePaths: ['a.ts'] }] },
}

const mr = { host: 'self.host', project: 'g/p', iid: '5' }

function stub(notes: object[]) {
  const writes: { method: string, path: string, body: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace('/api/v4/projects/g%2Fp/merge_requests/5', '')
    if ((init?.method ?? 'GET') === 'GET')
      return Response.json(notes)
    writes.push({ method: init!.method!, path, body: JSON.parse(String(init!.body)).body })
    return Response.json({ id: 99 })
  }))
  return writes
}

describe('createGitlabSharingApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('finds shared analyses among the notes, skipping system notes and plain comments', async () => {
    stub([
      { id: 1, body: renderSharedAnalysisBody('l', analysis), system: false, author: { username: 'bot' }, updated_at: '2026-01-02' },
      { id: 2, body: 'lgtm', system: false, author: { username: 'dev' }, updated_at: '2026-01-02' },
      { id: 3, body: renderSharedAnalysisBody('l', analysis), system: true, author: { username: 'sys' }, updated_at: '2026-01-02' },
    ])
    const list = await createGitlabSharingApi(createGitlabClient('self.host'), mr, 'https://review.internal').list()
    expect(list).toEqual([{ id: 1, login: 'bot', url: 'https://self.host/g/p/-/merge_requests/5#note_1', updatedAt: '2026-01-02', analysis }])
  })

  it('posts a note linking to this deployment, or updates the author\'s own', async () => {
    const writes = stub([{ id: 7, body: renderSharedAnalysisBody('l', analysis), system: false, author: { username: 'me' }, updated_at: '' }])
    const api = createGitlabSharingApi(createGitlabClient('self.host'), mr, 'https://review.internal')
    await api.upsert('other', analysis)
    await api.upsert('me', analysis)
    expect(writes.map(w => `${w.method} ${w.path}`)).toEqual(['POST /notes', 'PUT /notes/7'])
    expect(writes[0]!.body).toContain('https://review.internal/gl/self.host/g/p/-/merge_requests/5?from=other')
    expect(writes[0]!.body).toContain('Review this merge request')
  })
})
