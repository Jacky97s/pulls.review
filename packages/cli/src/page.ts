import type { GithubLocation } from '@pulls.review/core/github'
import type { GitlabLocation } from '@pulls.review/core/gitlab'
import { parseGithubUrl } from '@pulls.review/core/github'
import { parseGitlabUrl } from '@pulls.review/core/gitlab'
import { isLocalBranch, parseTarget, readCurrentBranch, resolveDefaultBranch } from '@pulls.review/core/local'

/** The site's `/gh/...` routes, which the `PR_LOCAL` build serves too. */
function githubPage(location: GithubLocation): string {
  const repo = `/gh/${location.owner}/${location.repo}`
  switch (location.kind) {
    case 'github-pr':
      return `${repo}/${location.number}`
    case 'github-compare':
      return `${repo}/compare/${location.base}...${location.head}`
    case 'github-commit':
      return `${repo}/commit/${location.sha}`
    case 'github-repo':
      return repo
  }
}

/** The site's `/gl/...` routes, for gitlab.com and self-hosted instances alike. */
function gitlabPage(location: GitlabLocation): string {
  const project = `/gl/${location.host}/${location.project}`
  switch (location.kind) {
    case 'gitlab-mr':
      return `${project}/-/merge_requests/${location.iid}`
    case 'gitlab-compare':
      return `${project}/-/compare/${location.base}...${location.head}`
    case 'gitlab-commit':
      return `${project}/-/commit/${location.sha}`
    case 'gitlab-project':
      return project
  }
}

/** The page an argument opens (see the app's local routes). */
export async function pageFor(cwd: string, arg: string | undefined, worktree: boolean): Promise<string> {
  if (worktree)
    return '/worktree'
  if (!arg) {
    const [current, defaultBranch] = await Promise.all([readCurrentBranch(cwd), resolveDefaultBranch(cwd)])
    return current && defaultBranch && current !== defaultBranch.name ? `/branch/${current}` : '/'
  }
  const github = parseGithubUrl(arg)
  if (github)
    return githubPage(github)
  const gitlab = parseGitlabUrl(arg)
  if (gitlab)
    return gitlabPage(gitlab)
  // Fails on a malformed target here, before a browser opens onto an error.
  const target = parseTarget(arg)
  if (target.kind === 'range')
    return `/compare/${arg}`
  return await isLocalBranch(cwd, arg) ? `/branch/${arg}` : `/commit/${arg}`
}

/** Encode a page path without treating a valid `#` in a git ref as a URL fragment. */
export function browserPath(page: string): string {
  return encodeURI(page).replaceAll('#', '%23')
}
