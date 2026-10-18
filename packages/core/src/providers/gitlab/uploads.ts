import type { GitlabClient } from './client'
import { GitlabApiError, projectPath } from './client'

/** A file uploaded to a project, as GitLab's Markdown references it. */
export interface GitlabUpload {
  /** The project's path, or its numeric id in the `/-/project/<id>/` form. */
  project: string
  secret: string
  filename: string
}

/**
 * The upload a Markdown image points at: `/uploads/<secret>/<file>` relative to the
 * project (how GitLab writes them), or an absolute URL on `host` in the project-path or
 * `/-/project/<id>/` form. `undefined` for anything else.
 */
export function parseGitlabUpload(src: string, host: string, project: string): GitlabUpload | undefined {
  const relative = src.match(/^\/?uploads\/([0-9a-f]{16,})\/([^?#]+)$/)
  if (relative)
    return { project, secret: relative[1]!, filename: decodeURIComponent(relative[2]!) }
  let url: URL
  try {
    url = new URL(src)
  }
  catch {
    return undefined
  }
  if (url.host !== host)
    return undefined
  const match = decodeURIComponent(url.pathname).match(/^\/(?:-\/project\/(\d+)|(.+?))\/uploads\/([0-9a-f]{16,})\/(.+)$/)
  return match ? { project: match[1] ?? match[2]!, secret: match[3]!, filename: match[4]! } : undefined
}

/**
 * The upload's bytes through the API, which takes the token: the web URL wants a signed-in
 * browser session, which a cross-site image request can't rely on. Needs GitLab 17.4+.
 */
export async function fetchGitlabUpload(client: GitlabClient, { project, secret, filename }: GitlabUpload): Promise<Blob | undefined> {
  const id = /^\d+$/.test(project) ? `/projects/${project}` : projectPath(project)
  try {
    return await (await client.request(`${id}/uploads/${secret}/${encodeURIComponent(filename)}`)).blob()
  }
  catch (err) {
    if (err instanceof GitlabApiError && err.status === 404)
      return undefined
    throw err
  }
}
