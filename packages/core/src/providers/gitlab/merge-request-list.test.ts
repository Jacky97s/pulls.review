import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticCredentials } from '../../types/source'
import { createGitlabClient } from './client'
import { fetchOpenMergeRequests, resolveGitlabNamespace } from './merge-request-list'

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

describe('group merge request lists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists a group\'s merge requests, each naming its own project', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([{ ...mr, references: { full: 'team/sub/svc!7' } }], { headers: { 'x-total': '1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const page = await fetchOpenMergeRequests(createGitlabClient('self.host'), 'team', undefined, 'group')

    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/api/v4/groups/team/merge_requests')
    expect(page.items[0]).toMatchObject({ number: 7, repository: 'team/sub/svc' })
  })

  it('leaves a project\'s items without a repository', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ ...mr, references: { full: 'g/p!7' } }])))
    expect((await fetchOpenMergeRequests(createGitlabClient('self.host'), 'g/p')).items[0]!.repository).toBeUndefined()
  })

  it('tells a project from a group by whether GitLab finds a project there', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new URL(url).pathname === '/api/v4/projects/g%2Fp' ? Response.json({}) : Response.json({ message: '404 Project Not Found' }, { status: 404 })))
    expect(await resolveGitlabNamespace(createGitlabClient('self.host'), 'g/p')).toBe('project')
    expect(await resolveGitlabNamespace(createGitlabClient('self.host'), 'team')).toBe('group')
  })
})
