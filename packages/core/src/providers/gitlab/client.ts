import type { Credentials } from '../../types/source'

const PAGE_SIZE = 100

export class GitlabApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'GitlabApiError'
  }
}

/** Every GitLab REST call goes through one of these, bound to one instance and its token. */
export interface GitlabClient {
  host: string
  token: () => Promise<string | undefined>
  /** `path` is relative to `/api/v4`. Throws `GitlabApiError` on a non-ok response. */
  request: (path: string) => Promise<Response>
  /** Follows `per_page=100` pages until a short one comes back. */
  paginate: <T>(path: string) => Promise<T[]>
}

/** The URL-encoded id GitLab accepts for a project in place of its numeric id. */
export function projectPath(project: string): string {
  return `/projects/${encodeURIComponent(project)}`
}

export function createGitlabClient(host: string, credentials?: Credentials): GitlabClient {
  const token = async () => credentials?.gitlabToken?.(host)

  async function request(path: string): Promise<Response> {
    const auth = await token()
    const headers: Record<string, string> = { Accept: 'application/json' }
    // Bearer carries both a personal access token and an OAuth access token.
    if (auth)
      headers.Authorization = `Bearer ${auth}`
    const url = `https://${host}/api/v4${path}`
    let res: Response
    try {
      res = await fetch(url, { headers })
    }
    catch (err) {
      // A browser reports a CORS refusal as a bare network error, indistinguishable from the host being down.
      throw new GitlabApiError(0, `Could not reach ${host}. It may be offline, or not allow requests from this site (CORS). (${(err as Error).message})`)
    }
    if (!res.ok) {
      let message: string | undefined
      try {
        const body = await res.json() as { message?: unknown, error?: string }
        message = typeof body.message === 'string' ? body.message : body.error
      }
      catch {}
      throw new GitlabApiError(res.status, message ?? `GitLab API request failed (${res.status}): ${url}`)
    }
    return res
  }

  return {
    host,
    token,
    request,
    async paginate<T>(path: string) {
      const items: T[] = []
      const separator = path.includes('?') ? '&' : '?'
      for (let page = 1; ; page++) {
        const pageItems: T[] = await (await request(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`)).json()
        items.push(...pageItems)
        if (pageItems.length < PAGE_SIZE)
          return items
      }
    },
  }
}
