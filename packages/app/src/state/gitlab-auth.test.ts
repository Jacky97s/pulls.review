import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeGitlabSignIn, gitlabAccessToken, startGitlabSignIn } from './gitlab-auth'
import { settings } from './settings'

function tokenResponse(accessToken: string, refreshToken: string) {
  return Response.json({ access_token: accessToken, refresh_token: refreshToken, expires_in: 7200, created_at: Math.floor(Date.now() / 1000) })
}

describe('gitlab sign-in', () => {
  const assign = vi.fn()

  beforeEach(() => {
    settings.value = { ...settings.value, gitlab: { 'self.host': { token: '', clientId: 'cid' } } }
    vi.stubGlobal('location', { origin: 'https://app.test', assign })
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    assign.mockReset()
  })

  async function signIn(returnTo = '/gl/self.host/g/p/-/merge_requests/1') {
    await startGitlabSignIn('self.host', returnTo)
    return new URL(assign.mock.calls[0]![0] as string)
  }

  it('sends the browser to the instance and stores the session on the way back', async () => {
    const authorize = await signIn()
    expect(authorize.origin).toBe('https://self.host')
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://app.test/oauth/gitlab')
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse('at', 'rt')))

    const next = await completeGitlabSignIn({ code: 'c', state: authorize.searchParams.get('state')! })

    expect(next).toBe('/gl/self.host/g/p/-/merge_requests/1')
    expect(settings.value.gitlab['self.host']).toMatchObject({ token: 'at', refreshToken: 'rt', clientId: 'cid' })
  })

  it('refuses a callback whose state does not match, and never reuses the pending sign-in', async () => {
    const authorize = await signIn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(completeGitlabSignIn({ code: 'c', state: 'forged' })).rejects.toThrow(/invalid or expired/)
    await expect(completeGitlabSignIn({ code: 'c', state: authorize.searchParams.get('state')! })).rejects.toThrow(/invalid or expired/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only returns to a path on this site', async () => {
    const authorize = await signIn('//evil.example/x')
    vi.stubGlobal('fetch', vi.fn(async () => tokenResponse('at', 'rt')))
    expect(await completeGitlabSignIn({ code: 'c', state: authorize.searchParams.get('state')! })).toBe('/')
  })

  it('renews an expiring token once for concurrent requests', async () => {
    settings.value = { ...settings.value, gitlab: { 'self.host': { token: 'old', refreshToken: 'rt', expiresAt: Date.now() + 1000, clientId: 'cid' } } }
    const fetchMock = vi.fn(async () => tokenResponse('new', 'rt2'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await Promise.all([gitlabAccessToken('self.host'), gitlabAccessToken('self.host')])).toEqual(['new', 'new'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(settings.value.gitlab['self.host']).toMatchObject({ token: 'new', refreshToken: 'rt2' })
  })

  it('signs out when GitLab refuses the refresh, keeping the application id', async () => {
    settings.value = { ...settings.value, gitlab: { 'self.host': { token: 'old', refreshToken: 'rt', expiresAt: Date.now() - 1, clientId: 'cid' } } }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })))

    expect(await gitlabAccessToken('self.host')).toBeUndefined()
    expect(settings.value.gitlab['self.host']).toEqual({ token: '', clientId: 'cid' })
  })

  it('sends a personal access token as is', async () => {
    settings.value = { ...settings.value, gitlab: { 'self.host': { token: 'glpat-x' } } }
    expect(await gitlabAccessToken('self.host')).toBe('glpat-x')
  })
})
