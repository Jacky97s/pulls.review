import type { LlmSettings } from '@pulls.review/core/analyze'
import type { Locale } from '@pulls.review/core/locales'
import { defaultLlmSettings, deriveProvider } from '@pulls.review/core/analyze'
import { detectLocale, isLocale } from '@pulls.review/core/locales'
import { useLocalStorage } from '@vueuse/core'

/** How this browser authenticates to one GitLab instance. */
export interface GitlabHostAuth {
  /** A personal access token, or the access token of an OAuth sign-in. */
  token: string
  /** Set for an OAuth sign-in: renews `token` once it nears `expiresAt` (epoch ms). */
  refreshToken?: string
  expiresAt?: number
  /** The GitLab Application to sign in through, when this host has no build-time one. */
  clientId?: string
}

export interface Settings {
  githubToken: string
  /** Keyed by host (`gitlab.com`, `gitlab.example.com:8443`); a token is only sent to its own host. */
  gitlab: Record<string, GitlabHostAuth>
  llm: LlmSettings
  /** UI language and the language the LLM writes summaries in; seeded from the browser's preference. */
  locale: Locale
}

const defaultSettings: Settings = {
  githubToken: '',
  gitlab: {},
  llm: defaultLlmSettings,
  locale: detectLocale(),
}

/**
 * Every setting lives under one localStorage key - needs synchronous access before a
 * provider call, so localStorage over unstorage/IndexedDB. A plain module-level
 * singleton (like `state/dark.ts`'s `isDark`) - every caller shares the same value.
 */
export const settings = useLocalStorage<Settings>('diffs:settings', defaultSettings, {
  mergeDefaults: (storage, defaults) => {
    const llm: LlmSettings = { ...defaults.llm, ...storage?.llm }
    // Settings stored before `provider` existed picked a provider by key priority;
    // seed the explicit selection the same way so existing setups keep working.
    if (!storage?.llm?.provider)
      llm.provider = deriveProvider(llm)
    // A locale this build no longer ships (or none stored yet) falls back to the browser's.
    const locale = isLocale(storage?.locale) ? storage.locale : defaults.locale
    return { ...defaults, ...storage, llm, locale }
  },
})
