import type { SourceRef } from '../../types/source'
import { splitRange } from '../github/url'

export const GITLAB_CLOUD_HOST = 'gitlab.com'

/** What a GitLab URL points at: a diff the app can open, or a project (its MR list). */
export type GitlabLocation
  = | Extract<SourceRef, { kind: 'gitlab-mr' | 'gitlab-compare' | 'gitlab-commit' }>
    | { kind: 'gitlab-project', host: string, project: string }

/**
 * A pasted GitLab URL from gitlab.com or any self-hosted instance (an MR, compare or
 * commit page, a project or its `/-/merge_requests`), or `group/project!123` on gitlab.com.
 * A self-hosted host can't be told from any other site by name, so its URL MUST carry
 * GitLab's `/-/` separator; only gitlab.com accepts a bare project URL.
 */
export function parseGitlabUrl(text: string): GitlabLocation | undefined {
  const trimmed = text.trim()
  const shorthand = trimmed.match(/^([\w.-]+(?:\/[\w.-]+)+)!(\d+)$/)
  if (shorthand)
    return { kind: 'gitlab-mr', host: GITLAB_CLOUD_HOST, project: shorthand[1]!, iid: shorthand[2]! }

  let url: URL
  try {
    url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
  }
  catch {
    return undefined
  }
  const host = url.host
  if (host === 'github.com' || host === 'www.github.com')
    return undefined
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').replace(/^\//, '')
  const separator = path.indexOf('/-/')
  if (separator === -1) {
    return host === GITLAB_CLOUD_HOST && path.includes('/')
      ? { kind: 'gitlab-project', host, project: path }
      : undefined
  }
  const project = path.slice(0, separator)
  const [kind, ...rest] = path.slice(separator + 3).split('/')
  const tail = rest.join('/')
  if (!project.includes('/'))
    return undefined
  switch (kind) {
    case 'merge_requests': {
      const iid = tail.match(/^\d+/)?.[0]
      return iid ? { kind: 'gitlab-mr', host, project, iid } : { kind: 'gitlab-project', host, project }
    }
    case 'commit':
      return rest[0] ? { kind: 'gitlab-commit', host, project, sha: rest[0] } : undefined
    case 'compare': {
      const range = splitRange(tail)
      return range && { kind: 'gitlab-compare', host, project, ...range }
    }
    default:
      return { kind: 'gitlab-project', host, project }
  }
}
