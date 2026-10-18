import type { Env } from '@pulls.review/core/env'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { githubTokenFromEnv, gitlabTokenFromEnv } from '@pulls.review/core/env'

/** The environment first, then the GitHub CLI's login, if `gh` is installed and signed in. */
export async function resolveGithubToken(env: Env): Promise<string | undefined> {
  const fromEnv = githubTokenFromEnv(env)
  if (fromEnv)
    return fromEnv
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token'])
    return stdout.trim() || undefined
  }
  catch {
    return undefined
  }
}

/** The environment first (for the host it names), then glab's login for that host, if `glab` is installed. */
export async function resolveGitlabToken(env: Env, host: string): Promise<string | undefined> {
  const fromEnv = gitlabTokenFromEnv(env, host)
  if (fromEnv)
    return fromEnv
  try {
    const { stdout } = await promisify(execFile)('glab', ['config', 'get', 'token', '--host', host])
    return stdout.trim() || undefined
  }
  catch {
    return undefined
  }
}
