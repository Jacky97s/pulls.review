import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticCredentials } from '../../types/source'
import { createGitlabClient } from './client'
import { DEFAULT_GITLAB_MR_FILTERS, fetchGitlabLabelNames, fetchGitlabUsername, fetchMergeRequests, resolveGitlabNamespace, toGitlabParams } from './merge-request-list'

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

describe('fetchMergeRequests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads one page of open merge requests into the shared list shape', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([mr], { headers: { 'x-total': '150', 'x-next-page': '2' } }))
    vi.stubGlobal('fetch', fetchMock)

    const page = await fetchMergeRequests(createGitlabClient('self.host', staticCredentials(undefined, { 'self.host': 't' })), 'g/p')

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
    expect(await fetchMergeRequests(createGitlabClient('self.host'), 'g/p', { next: '3' })).toMatchObject({ next: undefined, totalCount: 201 })
  })
})

describe('group merge request lists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists a group\'s merge requests, each naming its own project', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([{ ...mr, references: { full: 'team/sub/svc!7' } }], { headers: { 'x-total': '1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const page = await fetchMergeRequests(createGitlabClient('self.host'), 'team', { kind: 'group' })

    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/api/v4/groups/team/merge_requests')
    expect(page.items[0]).toMatchObject({ number: 7, repository: 'team/sub/svc' })
  })

  it('leaves a project\'s items without a repository', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ ...mr, references: { full: 'g/p!7' } }])))
    expect((await fetchMergeRequests(createGitlabClient('self.host'), 'g/p')).items[0]!.repository).toBeUndefined()
  })

  it('tells a project from a group by whether GitLab finds a project there', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new URL(url).pathname === '/api/v4/projects/g%2Fp' ? Response.json({}) : Response.json({ message: '404 Project Not Found' }, { status: 404 })))
    expect(await resolveGitlabNamespace(createGitlabClient('self.host'), 'g/p')).toBe('project')
    expect(await resolveGitlabNamespace(createGitlabClient('self.host'), 'team')).toBe('group')
  })
})

describe('toGitlabParams', () => {
  it('asks for open merge requests and nothing else by default', () => {
    expect(toGitlabParams(DEFAULT_GITLAB_MR_FILTERS)).toEqual({ state: 'opened' })
  })

  it.each([
    ['author', 'author_username'],
    ['assignee', 'assignee_username'],
    ['reviewer', 'reviewer_username'],
  ] as const)('sends the token user as %s', (mine, param) => {
    expect(toGitlabParams({ ...DEFAULT_GITLAB_MR_FILTERS, mine }, 'alice')).toEqual({ state: 'opened', [param]: 'alice' })
  })

  it('refuses a "mine" filter without a user rather than listing everyone\'s', () => {
    expect(() => toGitlabParams({ ...DEFAULT_GITLAB_MR_FILTERS, mine: 'author' })).toThrow(/sign in/)
  })

  it.each([
    ['any', undefined],
    ['only', 'yes'],
    ['hide', 'no'],
  ] as const)('maps draft %s to wip=%s', (draft, wip) => {
    expect(toGitlabParams({ ...DEFAULT_GITLAB_MR_FILTERS, draft }).wip).toBe(wip)
  })

  it('joins labels, and passes the state and target branch through', () => {
    expect(toGitlabParams({ state: 'merged', labels: ['a', 'b c'], draft: 'any', targetBranch: 'main' })).toEqual({ state: 'merged', labels: 'a,b c', target_branch: 'main' })
  })
})

describe('filtered merge request lists', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends every filter as a query parameter and reads merged and closed states', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([{ ...mr, state: 'merged' }, { ...mr, state: 'closed', draft: false }, { ...mr, state: 'opened', draft: false }]))
    vi.stubGlobal('fetch', fetchMock)

    const page = await fetchMergeRequests(createGitlabClient('self.host'), 'g/p', {
      filters: { state: 'all', mine: 'reviewer', labels: ['bug', 'ui'], draft: 'hide', targetBranch: 'release' },
      username: 'alice',
    })

    expect(Object.fromEntries(new URL(fetchMock.mock.calls[0]![0]).searchParams)).toMatchObject({
      state: 'all',
      reviewer_username: 'alice',
      labels: 'bug,ui',
      wip: 'no',
      target_branch: 'release',
    })
    expect(page.items.map(item => item.state)).toEqual(['merged', 'closed', 'open'])
  })

  it('reads the token user and the label names of a project or group', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const { pathname } = new URL(url)
      return Response.json(pathname.endsWith('/user') ? { username: 'alice' } : [{ name: 'bug' }, { name: 'ui' }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createGitlabClient('self.host')

    expect(await fetchGitlabUsername(client)).toBe('alice')
    expect(await fetchGitlabLabelNames(client, 'g/p', 'project')).toEqual(['bug', 'ui'])
    expect(await fetchGitlabLabelNames(client, 'team', 'group')).toEqual(['bug', 'ui'])
    const urls = fetchMock.mock.calls.map(([url]) => new URL(url))
    expect(urls[1]!.pathname).toBe('/api/v4/projects/g%2Fp/labels')
    expect(urls[2]!.pathname).toBe('/api/v4/groups/team/labels')
    expect(urls[2]!.searchParams.get('include_descendant_groups')).toBe('true')
  })
})
