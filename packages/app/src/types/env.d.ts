interface ImportMetaEnv {
  /**
   * Whether LLM analysis and chat are compiled in. `false` in the embed build, so the
   * pi runtime and `@ai-sdk/gateway` are never bundled there. See `features()` in
   * `vite.config.shared.ts`. Test for truthiness only: Vitest exposes defines through
   * `process.env`, where this is the string `'true'` (and `vi.stubEnv('PR_LLM', undefined)`
   * turns it off).
   */
  readonly PR_LLM: boolean
  /**
   * Whether this is the github.com embed build (`true` only in `vite.config.embed.ts`).
   * Guards SPA-only behaviour that must never touch the host page - e.g. `useDocumentTitle`
   * skips writing the tab title so the embed never hijacks github.com's `<title>`. Same
   * truthiness-only testing rule as `PR_LLM`.
   */
  readonly PR_EMBED: boolean
  /**
   * Whether this is the `pulls.review` CLI's build (`vite.config.local.ts`), served by its
   * devframe server: the cache and GitHub token come over RPC, and `/local` reviews a
   * local git diff. Same truthiness-only testing rule as `PR_LLM`.
   */
  readonly PR_LOCAL: boolean
  /** `host=clientId` pairs (comma-separated) of the GitLab Applications users sign in through; see `state/gitlab-auth.ts`. */
  readonly VITE_GITLAB_OAUTH_CLIENTS?: string
  /** Origin shared-analysis notes on GitLab link to; defaults to the page's own origin. */
  readonly VITE_SITE_URL?: string
  /** Short git sha the embed bundle was built from; only defined by `vite.config.embed.ts`. */
  readonly PR_EMBED_SHA: string | undefined
}

interface Window {
  /** Optional server-wide defaults written by Docker Compose at container startup. */
  __PULLS_REVIEW_CONFIG__?: {
    provider?: string
    apiKey?: string
    model?: string
    baseUrl?: string
    locale?: string
  }
}
