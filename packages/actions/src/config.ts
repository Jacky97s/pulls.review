import type { Env } from '@pulls.review/core/env'
import type { PullRequestRef } from '@pulls.review/core/github'
import type { GitlabMergeRequestRef } from '@pulls.review/core/gitlab'
import type { Locale } from '@pulls.review/core/locales'
import { githubTokenFromEnv } from '@pulls.review/core/env'
import { parseGitlabUrl } from '@pulls.review/core/gitlab'
import { DEFAULT_LOCALE, isLocale } from '@pulls.review/core/locales'

export interface Flags {
  provider?: string
  model?: string
  locale?: string
}

/** The first value that is set and not blank: an Action passes unset inputs as `''`. */
function first(...values: (string | undefined)[]): string | undefined {
  return values.find(value => value)
}

export function resolveGithubToken(env: Env): string {
  const token = githubTokenFromEnv(env)
  if (!token)
    throw new Error('A GitHub token is required: set GITHUB_TOKEN (or PULLS_REVIEW_GITHUB_TOKEN).')
  return token
}

export function resolveLocale(env: Env, flags: Flags = {}): Locale {
  const requested = first(flags.locale, env.PULLS_REVIEW_LOCALE)
  if (requested === undefined)
    return DEFAULT_LOCALE
  if (!isLocale(requested))
    throw new Error(`Unsupported locale "${requested}".`)
  return requested
}

/** The `pull_request` payload fields the target is read from; `GITHUB_EVENT_PATH` points at the JSON. */
export interface GithubEvent {
  pull_request?: { number: number }
}

/**
 * `owner/repo#123` or a github.com PR URL; in a workflow run, the PR the event is about.
 */
export function resolveTarget(arg: string | undefined, env: Env, event?: GithubEvent): PullRequestRef {
  if (arg) {
    const match = arg.match(/^(?:https:\/\/github\.com\/)?([^/\s]+)\/([^/#\s]+)(?:#|\/pull\/)(\d+)\/?$/)
    if (!match)
      throw new Error(`Cannot read a pull request from "${arg}": expected owner/repo#123 or a github.com pull request URL.`)
    return { owner: match[1]!, repo: match[2]!, number: match[3]! }
  }
  const [owner, repo] = env.GITHUB_REPOSITORY?.split('/') ?? []
  const number = event?.pull_request?.number
  if (!owner || !repo || number === undefined)
    throw new Error('No pull request given. Pass owner/repo#123, or run on a pull_request event in GitHub Actions.')
  return { owner, repo, number: String(number) }
}

/**
 * A GitLab merge request to analyze: a merge request URL from any instance, or
 * `group/project!123` on gitlab.com; with no argument, the merge request pipeline's own
 * (`CI_MERGE_REQUEST_IID`). `undefined` when neither names one - a GitHub target, then.
 */
export function resolveGitlabTarget(arg: string | undefined, env: Env): GitlabMergeRequestRef | undefined {
  if (arg) {
    const location = parseGitlabUrl(arg)
    return location?.kind === 'gitlab-mr' ? { host: location.host, project: location.project, iid: location.iid } : undefined
  }
  const { CI_SERVER_HOST: host, CI_PROJECT_PATH: project, CI_MERGE_REQUEST_IID: iid } = env
  return host && project && iid ? { host, project, iid } : undefined
}

export function resolveGitlabToken(env: Env): string {
  const token = first(env.PULLS_REVIEW_GITLAB_TOKEN, env.GITLAB_TOKEN)
  if (!token)
    throw new Error('A GitLab token with the api scope is required: set GITLAB_TOKEN (or PULLS_REVIEW_GITLAB_TOKEN). A CI job token cannot post notes.')
  return token
}
