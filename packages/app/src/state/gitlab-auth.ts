import type { GitlabHostAuth } from './settings'
import { createPkcePair, exchangeGitlabCode, GitlabApiError, gitlabAuthorizeUrl, randomToken, refreshGitlabToken } from '@pulls.review/core/gitlab'
import { settings } from './settings'

/** One pending sign-in at a time: it only has to survive the round trip through GitLab. */
const PENDING_KEY = 'diffs:gitlab-oauth'
/** Renew this long before expiry, so a request never leaves with a token about to lapse. */
const REFRESH_MARGIN_MS = 60_000

interface PendingSignIn {
  host: string
  clientId: string
  state: string
  verifier: string
  returnTo: string
}

/**
 * GitLab Applications registered for this deployment, as `host=clientId` pairs separated
 * by commas: an internal build names its instance's application once, for everyone.
 */
function buildTimeClients(): Record<string, string> {
  const raw: string = import.meta.env.VITE_GITLAB_OAUTH_CLIENTS ?? ''
  return Object.fromEntries(raw.split(',').map(pair => pair.trim().split('=')).filter(([host, id]) => host && id).map(([host, id]) => [host!.trim().toLowerCase(), id!.trim()]))
}

export function gitlabClientId(host: string): string | undefined {
  return settings.value.gitlab[host]?.clientId || buildTimeClients()[host]
}

export function gitlabRedirectUri(): string {
  return `${location.origin}/oauth/gitlab`
}

function saveHost(host: string, auth: GitlabHostAuth | undefined) {
  const { [host]: _, ...rest } = settings.value.gitlab
  settings.value = { ...settings.value, gitlab: auth ? { ...rest, [host]: auth } : rest }
}

/** Leaves for GitLab's consent page; `completeGitlabSignIn` picks up on the way back. */
export async function startGitlabSignIn(host: string, returnTo: string): Promise<void> {
  const clientId = gitlabClientId(host)
  if (!clientId)
    throw new Error(`No GitLab Application is configured for ${host}`)
  const { verifier, challenge } = await createPkcePair()
  const pending: PendingSignIn = { host, clientId, state: randomToken(), verifier, returnTo }
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  location.assign(gitlabAuthorizeUrl({ host, clientId, redirectUri: gitlabRedirectUri(), state: pending.state, challenge }))
}

/** Only a path on this site, so the callback can never be turned into an open redirect. */
function safeReturnTo(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/'
}

/** Finishes the sign-in GitLab redirected back from; returns where to go next. */
export async function completeGitlabSignIn(query: { code?: string, state?: string, error?: string, error_description?: string }): Promise<string> {
  const raw = sessionStorage.getItem(PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  const pending = raw ? JSON.parse(raw) as PendingSignIn : undefined
  if (query.error)
    throw new Error(query.error_description || query.error)
  if (!pending || !query.code || !query.state || query.state !== pending.state)
    throw new Error('This sign-in link is invalid or expired. Start the sign-in again.')
  const token = await exchangeGitlabCode({ host: pending.host, clientId: pending.clientId, redirectUri: gitlabRedirectUri(), code: query.code, verifier: pending.verifier })
  saveHost(pending.host, { token: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt, clientId: settings.value.gitlab[pending.host]?.clientId })
  return safeReturnTo(pending.returnTo)
}

const refreshing = new Map<string, Promise<string | undefined>>()

async function refresh(host: string, auth: GitlabHostAuth & { refreshToken: string }): Promise<string | undefined> {
  const clientId = gitlabClientId(host)
  if (!clientId)
    return auth.token
  try {
    const token = await refreshGitlabToken({ host, clientId, redirectUri: gitlabRedirectUri(), refreshToken: auth.refreshToken })
    saveHost(host, { ...auth, token: token.accessToken, refreshToken: token.refreshToken || auth.refreshToken, expiresAt: token.expiresAt })
    return token.accessToken
  }
  catch (err) {
    // A refused grant (revoked, or the refresh token already used) can't recover: sign out
    // so the page asks to sign in again. Anything else may be transient - keep the session.
    if (err instanceof GitlabApiError && (err.status === 400 || err.status === 401)) {
      saveHost(host, auth.clientId ? { token: '', clientId: auth.clientId } : undefined)
      return undefined
    }
    throw err
  }
}

/** The token to send to `host`, renewing an OAuth session that is about to expire. */
export async function gitlabAccessToken(host: string): Promise<string | undefined> {
  const auth = settings.value.gitlab[host]
  if (!auth?.token)
    return undefined
  if (!auth.refreshToken || !auth.expiresAt || auth.expiresAt - Date.now() > REFRESH_MARGIN_MS)
    return auth.token
  const refreshToken = auth.refreshToken
  // Concurrent requests share one refresh: GitLab rotates the refresh token on use.
  let pending = refreshing.get(host)
  if (!pending) {
    pending = refresh(host, { ...auth, refreshToken }).finally(() => refreshing.delete(host))
    refreshing.set(host, pending)
  }
  return pending
}
