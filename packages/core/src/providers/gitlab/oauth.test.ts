import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPkcePair, exchangeGitlabCode, gitlabAuthorizeUrl, refreshGitlabToken } from './oauth'

describe('gitlab oauth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('derives an S256 challenge from a fresh verifier', async () => {
    const a = await createPkcePair()
    const b = await createPkcePair()
    expect(a.verifier).toMatch(/^[\w-]{43,128}$/)
    expect(a.verifier).not.toBe(b.verifier)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier)))
    expect(a.challenge).toBe(btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
  })

  it('builds the authorize URL on the instance itself', () => {
    const url = new URL(gitlabAuthorizeUrl({ host: 'self.host', clientId: 'cid', redirectUri: 'https://app/oauth/gitlab', state: 'st', challenge: 'ch' }))
    expect(url.origin + url.pathname).toBe('https://self.host/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://app/oauth/gitlab',
      response_type: 'code',
      state: 'st',
      scope: 'api',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    })
  })

  it('exchanges a code with the verifier and no client secret', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 7200, created_at: 1_000 }))
    vi.stubGlobal('fetch', fetchMock)

    const token = await exchangeGitlabCode({ host: 'self.host', clientId: 'cid', redirectUri: 'https://app/oauth/gitlab', code: 'c', verifier: 'v' })

    expect(token).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: (1_000 + 7200) * 1000 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://self.host/oauth/token')
    const body = new URLSearchParams(String(init?.body))
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', client_id: 'cid', redirect_uri: 'https://app/oauth/gitlab', code: 'c', code_verifier: 'v' })
    expect(body.has('client_secret')).toBe(false)
  })

  it('refreshes with the refresh token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ access_token: 'at2', refresh_token: 'rt2', expires_in: 7200, created_at: 2_000 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshGitlabToken({ host: 'self.host', clientId: 'cid', redirectUri: 'https://app/oauth/gitlab', refreshToken: 'rt' })).resolves.toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' })
    expect(Object.fromEntries(new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body)))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'cid' })
  })

  it('reports GitLab\'s own reason when the grant is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant', error_description: 'The provided authorization grant is invalid' }, { status: 400 })))
    await expect(refreshGitlabToken({ host: 'self.host', clientId: 'cid', redirectUri: 'r', refreshToken: 'rt' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('authorization grant is invalid') })
  })
})
