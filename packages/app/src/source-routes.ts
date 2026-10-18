import type { SourceRef } from '@pulls.review/core/types'
import type { RouteComponent, RouteLocation, RouteRecordRaw } from 'vue-router'
import { parseGithubUrl, splitRange } from '@pulls.review/core/github'
import { parseGitlabUrl } from '@pulls.review/core/gitlab'

/**
 * The one place that maps diff refs to app routes and back. Components link through
 * these helpers instead of spelling out `/gh/...` paths.
 */

/** Every ref kind with a page of its own in this build. */
export type RoutableRef = Extract<SourceRef, { kind: 'github-pr' | 'github-compare' | 'github-commit' | 'gitlab-mr' | 'gitlab-compare' | 'gitlab-commit' }>

/** One route per routable ref kind, named after the kind so a route reads back into its ref. */
export function routes(component: () => Promise<RouteComponent>): RouteRecordRaw[] {
  // The page receives its ref as the `sourceRef` prop rather than reading the route.
  const props = (route: RouteLocation) => ({ sourceRef: refFromRoute(route) })
  return [
    { name: 'github-pr', path: '/gh/:owner/:repo/:number(\\d+)', component, props },
    // A range is `base...head`; either side may be a branch with slashes.
    { name: 'github-compare', path: '/gh/:owner/:repo/compare/:range(.+\\.\\.\\..+)', component, props },
    { name: 'github-commit', path: '/gh/:owner/:repo/commit/:sha', component, props },
    // A GitLab project path may nest groups, so it ends where GitLab's own `/-/` separator starts.
    { name: 'gitlab-mr', path: '/gl/:host/:project(.+)/-/merge_requests/:iid(\\d+)', component, props },
    { name: 'gitlab-compare', path: '/gl/:host/:project(.+)/-/compare/:range(.+\\.\\.\\..+)', component, props },
    { name: 'gitlab-commit', path: '/gl/:host/:project(.+)/-/commit/:sha', component, props },
  ]
}

export function routeForRef(ref: RoutableRef): string
export function routeForRef(ref: SourceRef): string | undefined
export function routeForRef(ref: SourceRef): string | undefined {
  switch (ref.kind) {
    case 'github-pr':
      return `/gh/${ref.owner}/${ref.repo}/${ref.number}`
    case 'github-compare':
      return `/gh/${ref.owner}/${ref.repo}/compare/${ref.base}...${ref.head}`
    case 'github-commit':
      return `/gh/${ref.owner}/${ref.repo}/commit/${ref.sha}`
    case 'gitlab-mr':
      return `/gl/${ref.host}/${ref.project}/-/merge_requests/${ref.iid}`
    case 'gitlab-compare':
      return `/gl/${ref.host}/${ref.project}/-/compare/${ref.base}...${ref.head}`
    case 'gitlab-commit':
      return `/gl/${ref.host}/${ref.project}/-/commit/${ref.sha}`
    case 'paste':
      // Deliberately unroutable: a paste has no live source to reopen from a link.
      return undefined
    case 'local':
      // Only the local server can open it (plans/09).
      return undefined
  }
}

export function refFromRoute(route: Pick<RouteLocation, 'name' | 'params'>): RoutableRef | undefined {
  const param = (name: string) => String(route.params[name])
  const owner = param('owner')
  const repo = param('repo')
  switch (route.name) {
    case 'github-pr':
      return { kind: 'github-pr', owner, repo, number: param('number') }
    case 'github-compare': {
      const range = splitRange(param('range'))
      return range && { kind: 'github-compare', owner, repo, ...range }
    }
    case 'github-commit':
      return { kind: 'github-commit', owner, repo, sha: param('sha') }
    case 'gitlab-mr':
      return { kind: 'gitlab-mr', host: param('host'), project: param('project'), iid: param('iid') }
    case 'gitlab-compare': {
      const range = splitRange(param('range'))
      return range && { kind: 'gitlab-compare', host: param('host'), project: param('project'), ...range }
    }
    case 'gitlab-commit':
      return { kind: 'gitlab-commit', host: param('host'), project: param('project'), sha: param('sha') }
  }
}

export function repoRoute(owner: string, repo: string): string {
  return `/gh/${owner}/${repo}`
}

/** A repository with a list of open pull/merge requests: GitHub's `owner/repo`, or a project on a GitLab host. */
export type ListedRepository = { owner: string, repo: string } | { host: string, project: string }

export function repositoryRoute(repository: ListedRepository): string {
  return 'host' in repository ? `/gl/${repository.host}/${repository.project}` : repoRoute(repository.owner, repository.repo)
}

/** The diff page of one listed pull/merge request. */
export function listItemRoute(repository: ListedRepository, number: number): string {
  return 'host' in repository
    ? routeForRef({ kind: 'gitlab-mr', host: repository.host, project: repository.project, iid: String(number) })
    : routeForRef({ kind: 'github-pr', owner: repository.owner, repo: repository.repo, number: String(number) })
}

/** How the host writes a request's number: GitHub's `#12`, GitLab's `!12`. */
export function listItemLabel(repository: ListedRepository, number: number): string {
  return `${'host' in repository ? '!' : '#'}${number}`
}

/** The repository's breadcrumb: its namespace and its name, each linked to the host's own pages. */
export function repositoryCrumbs(repository: ListedRepository): { namespace: { label: string, url: string, githubLogin?: string }, name: { label: string, url: string } } {
  if ('owner' in repository) {
    return {
      namespace: { label: repository.owner, url: `https://github.com/${repository.owner}`, githubLogin: repository.owner },
      name: { label: repository.repo, url: `https://github.com/${repository.owner}/${repository.repo}/pulls` },
    }
  }
  const slash = repository.project.lastIndexOf('/')
  const namespace = repository.project.slice(0, slash)
  return {
    namespace: { label: namespace, url: `https://${repository.host}/${namespace}` },
    name: { label: repository.project.slice(slash + 1), url: `https://${repository.host}/${repository.project}/-/merge_requests` },
  }
}

/** Where a diff sits, e.g. its repo's PR list - `undefined` for a ref with no parent view. */
export function parentForRef(ref: SourceRef): { route: string, label: string } | undefined {
  if ('owner' in ref)
    return { route: repoRoute(ref.owner, ref.repo), label: `${ref.owner}/${ref.repo}` }
  if ('host' in ref)
    return { route: repositoryRoute(ref), label: ref.project }
  return undefined
}

/**
 * A pasted github.com URL (or `owner/repo#123`) as an app route: a PR, compare or
 * commit opens its diff, a bare repo (or its `/pulls`) the PR list.
 */
export function routeFromGithubUrl(text: string): string | undefined {
  const location = parseGithubUrl(text)
  if (!location)
    return undefined
  return location.kind === 'github-repo' ? repoRoute(location.owner, location.repo) : routeForRef(location)
}

/** A pasted GitLab URL (gitlab.com or self-hosted) as an app route: a diff, or a project's merge request list. */
export function routeFromGitlabUrl(text: string): string | undefined {
  const location = parseGitlabUrl(text)
  if (!location)
    return undefined
  return location.kind === 'gitlab-project' ? repositoryRoute(location) : routeForRef(location)
}

/** Whichever host the pasted URL belongs to. */
export function routeFromUrl(text: string): string | undefined {
  return routeFromGithubUrl(text) ?? routeFromGitlabUrl(text)
}
