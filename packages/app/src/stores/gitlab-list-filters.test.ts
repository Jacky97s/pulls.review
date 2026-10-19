import type { GitlabMergeRequestFilters } from '@pulls.review/core/gitlab'
import { DEFAULT_GITLAB_MR_FILTERS } from '@pulls.review/core/gitlab'
import { describe, expect, it } from 'vitest'
import { isDefaultFilters, parseFilters, serializeFilters } from './gitlab-list-filters'

describe('gitlab list filters in the URL', () => {
  it('reads an empty query as the defaults and writes the defaults as an empty query', () => {
    expect(parseFilters({})).toEqual(DEFAULT_GITLAB_MR_FILTERS)
    expect(serializeFilters(DEFAULT_GITLAB_MR_FILTERS)).toEqual({})
    expect(isDefaultFilters(DEFAULT_GITLAB_MR_FILTERS)).toBe(true)
  })

  it('reads every filter from its query key', () => {
    expect(parseFilters({ state: 'merged', mine: 'author', labels: 'a,b', draft: 'hide', target: 'main' })).toEqual({
      state: 'merged',
      mine: 'author',
      labels: ['a', 'b'],
      draft: 'hide',
      targetBranch: 'main',
    })
  })

  it('round-trips a fully set filter', () => {
    const filters: GitlabMergeRequestFilters = { state: 'closed', mine: 'reviewer', labels: ['bug', 'ui'], draft: 'only', targetBranch: 'release/1.0' }
    expect(parseFilters(serializeFilters(filters))).toEqual(filters)
    expect(serializeFilters(filters)).toEqual({ state: 'closed', mine: 'reviewer', labels: 'bug,ui', draft: 'only', target: 'release/1.0' })
  })

  it('omits only the defaults when some filters are set', () => {
    expect(serializeFilters({ ...DEFAULT_GITLAB_MR_FILTERS, mine: 'assignee' })).toEqual({ mine: 'assignee' })
  })

  it('ignores unknown values, repeated keys and blank labels', () => {
    expect(parseFilters({ state: 'bogus', mine: 'nobody', draft: '1', labels: ' a ,, a', target: '  ' })).toEqual({
      ...DEFAULT_GITLAB_MR_FILTERS,
      mine: undefined,
      labels: ['a'],
      targetBranch: undefined,
    })
    expect(parseFilters({ state: ['all', 'merged'] }).state).toBe('all')
  })
})
