import type { GitlabMergeRequestFilters } from '@pulls.review/core/gitlab'
import { DEFAULT_GITLAB_MR_FILTERS, GITLAB_MR_DRAFT, GITLAB_MR_MINE, GITLAB_MR_STATES } from '@pulls.review/core/gitlab'

type Query = Record<string, string | null | (string | null)[] | undefined>

function first(value: Query[string]): string | undefined {
  const one = Array.isArray(value) ? value[0] : value
  return one ?? undefined
}

function oneOf<T extends string>(choices: readonly T[], value: string | undefined): T | undefined {
  return choices.find(choice => choice === value)
}

/** The filters a page URL's query stands for; anything unrecognised falls back to the default. */
export function parseFilters(query: Query): GitlabMergeRequestFilters {
  const labels = first(query.labels)?.split(',').map(label => label.trim()).filter(Boolean) ?? []
  return {
    state: oneOf(GITLAB_MR_STATES, first(query.state)) ?? DEFAULT_GITLAB_MR_FILTERS.state,
    mine: oneOf(GITLAB_MR_MINE, first(query.mine)),
    labels: [...new Set(labels)],
    draft: oneOf(GITLAB_MR_DRAFT, first(query.draft)) ?? DEFAULT_GITLAB_MR_FILTERS.draft,
    targetBranch: first(query.target)?.trim() || undefined,
  }
}

/** The URL query for `filters`, with every default left out so an unfiltered list keeps a clean URL. */
export function serializeFilters(filters: GitlabMergeRequestFilters): Record<string, string> {
  const query: Record<string, string | undefined> = {
    state: filters.state === DEFAULT_GITLAB_MR_FILTERS.state ? undefined : filters.state,
    mine: filters.mine,
    labels: filters.labels.length ? filters.labels.join(',') : undefined,
    draft: filters.draft === DEFAULT_GITLAB_MR_FILTERS.draft ? undefined : filters.draft,
    target: filters.targetBranch?.trim() || undefined,
  }
  return Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

export function isDefaultFilters(filters: GitlabMergeRequestFilters): boolean {
  return Object.keys(serializeFilters(filters)).length === 0
}
