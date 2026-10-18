import type { SourceRef } from '../../types/source'
import { splitRange } from '../github/url'

export const GITLAB_CLOUD_HOST = 'gitlab.com'

/** What a GitLab URL points at: a diff the app can open, or a project (its MR list). */
export type GitlabLocation
  = | Extract<SourceRef, { kind: 'gitlab-mr' | 'gitlab-compare' | 'gitlab-commit' }>
    /** A project or a group - both list merge requests; only GitLab can tell which it is. */
    | { kind: 'gitlab-project', host: string, project: string }

/** The page `[kind, ...rest]` names after a path's `/-/` separator. */
function locate(host: string, project: string, [kind, ...rest]: string[]): GitlabLocation | undefined {
  const tail = rest.join('/')
  // A single segment is a top-level group: it has a merge request list, but no diffs of its own.
  if (!project.includes('/'))
    return kind === 'merge_requests' && !rest.length ? { kind: 'gitlab-project', host, project } : undefined
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
  // `/groups/<path>/-/...` is the older form of a group's pages.
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').replace(/^\//, '').replace(/^groups\//, '')
  const separator = path.indexOf('/-/')
  if (separator === -1) {
    return host === GITLAB_CLOUD_HOST && path.includes('/')
      ? { kind: 'gitlab-project', host, project: path }
      : undefined
  }
  return locate(host, path.slice(0, separator), path.slice(separator + 3).split('/'))
}
