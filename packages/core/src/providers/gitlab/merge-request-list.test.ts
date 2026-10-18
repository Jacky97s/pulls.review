import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticCredentials } from '../../types/source'
import { createGitlabClient } from './client'
import { fetchOpenMergeRequests } from './merge-request-list'

const mr = {
  iid: 7,
  title: 'Add rates',
  web_url: 'https://self.host/g/p/-/merge_requests/7',
  draft: true,
  author: { username: 'alice', avatar_url: 'https://a/av.png' },
  labels: [{ name: 'bug', color: '#d9534f', description: null }],
  assignees: [{ username: 'bob', avatar_url: null }],
  milestone: { title: 'R5.20' },
  user_notes_count: 3,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
}

describe('fetchOpenMergeRequests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads one page of open merge requests into the shared list shape', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([mr], { headers: { 'x-total': '150', 'x-next-page': '2' } }))
    vi.stubGlobal('fetch', fetchMock)

    const page = await fetchOpenMergeRequests(createGitlabClient('self.host', staticCredentials(undefined, { 'self.host': 't' })), 'g/p')

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.pathname).toBe('/api/v4/projects/g%2Fp/merge_requests')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ state: 'opened', order_by: 'updated_at', sort: 'desc', page: '1' })
    expect(page).toEqual({
      totalCount: 150,
      next: '2',
      items: [{
        number: 7,
        title: 'Add rates',
        url: 'https://self.host/g/p/-/merge_requests/7',
        state: 'draft',
        author: { login: 'alice', avatarUrl: 'https://a/av.png' },
        labels: [{ name: 'bug', color: 'd9534f', description: undefined }],
        assignees: [{ login: 'bob', avatarUrl: '' }],
        milestone: 'R5.20',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
        comments: 3,
      }],
    })
  })

  it('ends on the last page, and estimates the total when GitLab omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([mr], { headers: { 'x-next-page': '' } })))
    expect(await fetchOpenMergeRequests(createGitlabClient('self.host'), 'g/p', '3')).toMatchObject({ next: undefined, totalCount: 201 })
  })
})
