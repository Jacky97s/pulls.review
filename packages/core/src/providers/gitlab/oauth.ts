import { GitlabApiError } from './client'

/**
 * Sign-in through a GitLab Application as a public client: authorization code with
 * PKCE and no client secret, so the browser can complete it without a backend.
 */

export interface GitlabOAuthToken {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
}

/** Comments and reviews write notes, which `read_api` cannot. */
export const GITLAB_OAUTH_SCOPE = 'api'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function createPkcePair(): Promise<{ verifier: string, challenge: string }> {
  const verifier = randomToken()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function gitlabAuthorizeUrl({ host, clientId, redirectUri, state, challenge }: { host: string, clientId: string, redirectUri: string, state: string, challenge: string }): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: GITLAB_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `https://${host}/oauth/authorize?${params}`
}

async function requestToken(host: string, params: Record<string, string>): Promise<GitlabOAuthToken> {
  const res = await fetch(`https://${host}/oauth/token`, { method: 'POST', body: new URLSearchParams(params) })
  const body = await res.json().catch(() => ({})) as { access_token?: string, refresh_token?: string, expires_in?: number, created_at?: number, error?: string, error_description?: string }
  if (!res.ok || !body.access_token)
    throw new GitlabApiError(res.status, body.error_description ?? body.error ?? `GitLab sign-in failed (${res.status})`)
  const issuedAt = body.created_at ? body.created_at * 1000 : Date.now()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? '',
    expiresAt: issuedAt + (body.expires_in ?? 7200) * 1000,
  }
}

export function exchangeGitlabCode({ host, clientId, redirectUri, code, verifier }: { host: string, clientId: string, redirectUri: string, code: string, verifier: string }): Promise<GitlabOAuthToken> {
  return requestToken(host, { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code, code_verifier: verifier })
}

export function refreshGitlabToken({ host, clientId, redirectUri, refreshToken }: { host: string, clientId: string, redirectUri: string, refreshToken: string }): Promise<GitlabOAuthToken> {
  return requestToken(host, { grant_type: 'refresh_token', client_id: clientId, redirect_uri: redirectUri, refresh_token: refreshToken })
}
