import type { LlmSettings } from '@pulls.review/core/analyze'
import type { PullRequestRef } from '@pulls.review/core/github'
import type { GitlabMergeRequestRef } from '@pulls.review/core/gitlab'
import type { runLlmAnalysis } from '@pulls.review/core/llm'
import type { Locale } from '@pulls.review/core/locales'
import type { AnalyzeProgress, DiffSource } from '@pulls.review/core/types'
import { resolveModel } from '@pulls.review/core/analyze'
import { diagnostics } from '@pulls.review/core/diagnostics'
import { ACTIONS_BOT_LOGIN, createGithubPullRequestSource } from '@pulls.review/core/github'
import { createGitlabMergeRequestSource } from '@pulls.review/core/gitlab'
import { staticCredentials } from '@pulls.review/core/types'

export interface RunOptions {
  pr: PullRequestRef
  githubToken: string
  llm: LlmSettings
  locale: Locale
  log: (line: string) => void
}

export type RunOutcome
  = | { status: 'up-to-date', url: string }
    | { status: 'posted', url: string }

function describeProgress(progress: AnalyzeProgress): string {
  switch (progress.kind) {
    case 'thinking':
      return `[${progress.step}] thinking`
    case 'reading':
      return `[${progress.step}] reading ${progress.paths.length} file${progress.paths.length === 1 ? '' : 's'}`
    case 'organizing':
      return `[${progress.step}] organizing groups`
  }
}

/**
 * Fetches the PR, analyzes it and upserts the shared-analysis comment, exactly like the
 * site's "share as comment" - one comment per author, found by its marker. A comment
 * already carrying the PR's current head sha is left alone, so re-runs on an unchanged
 * PR cost no model call.
 */
export async function run({ pr, githubToken, llm, locale, log }: RunOptions, analyze: typeof runLlmAnalysis): Promise<RunOutcome> {
  const source = createGithubPullRequestSource(pr, staticCredentials(githubToken))
  // A workflow's `GITHUB_TOKEN` cannot look itself up at `/user`.
  return analyzeAndShare(source, `${pr.owner}/${pr.repo}#${pr.number}`, ACTIONS_BOT_LOGIN, { llm, locale, log }, analyze)
}

export interface GitlabRunOptions extends Omit<RunOptions, 'pr' | 'githubToken'> {
  mr: GitlabMergeRequestRef
  /** Needs the `api` scope to post notes; a CI job token cannot. */
  gitlabToken: string
  /** Where the note links to: the deployment readers open (default pulls.review). */
  siteOrigin?: string
}

/** `run` for a GitLab merge request: the analysis lands as a merge request note. */
export async function runGitlab({ mr, gitlabToken, siteOrigin, llm, locale, log }: GitlabRunOptions, analyze: typeof runLlmAnalysis): Promise<RunOutcome> {
  const source = createGitlabMergeRequestSource(mr, staticCredentials(undefined, { [mr.host]: gitlabToken }), { siteOrigin })
  return analyzeAndShare(source, `${mr.host}/${mr.project}!${mr.iid}`, undefined, { llm, locale, log }, analyze)
}

async function analyzeAndShare(
  source: DiffSource,
  label: string,
  fallbackLogin: string | undefined,
  { llm, locale, log }: Pick<RunOptions, 'llm' | 'locale' | 'log'>,
  analyze: typeof runLlmAnalysis,
): Promise<RunOutcome> {
  const resolved = resolveModel(llm)
  if (!resolved)
    throw diagnostics.llmNotConfigured()
  const sharing = source.sharing!
  const [diff, viewer, comments] = await Promise.all([
    source.fetch(),
    source.viewer?.().catch(() => undefined),
    sharing.list(),
  ])
  const login = viewer?.login ?? fallbackLogin
  if (!login)
    throw new Error('The token cannot identify its user, so its earlier note cannot be found to update.')
  const headSha = diff.head?.sha ?? ''
  const existing = comments.find(comment => comment.login === login)
  if (existing && existing.analysis.headSha === headSha)
    return { status: 'up-to-date', url: existing.url }

  log(`Analyzing ${label} (${diff.files.length} files) with ${resolved.model.provider}/${resolved.model.id}`)
  const { result } = await analyze(diff, resolved, locale, { onProgress: progress => log(describeProgress(progress)) })
  const comment = await sharing.upsert(login, { headSha, result }, existing)
  return { status: 'posted', url: comment.url }
}
