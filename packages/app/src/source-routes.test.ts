import type { RoutableRef } from './source-routes'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { listItemLabel, listItemRoute, parentForRef, refFromRoute, routeForRef, routeFromGithubUrl, routeFromUrl, routes } from './source-routes'

const router = createRouter({ history: createMemoryHistory(), routes: routes(async () => ({})) })

describe('source routes', () => {
  it.each<RoutableRef>([
    { kind: 'github-pr', owner: 'antfu', repo: 'diffs', number: '12' },
    { kind: 'github-compare', owner: 'antfu', repo: 'diffs', base: 'main', head: 'feat/nested-branch' },
    { kind: 'github-compare', owner: 'antfu', repo: 'diffs', base: 'v1.0.0', head: 'a1b2c3d' },
    { kind: 'github-commit', owner: 'antfu', repo: 'diffs', sha: 'a1b2c3d4' },
  ])('round-trips a $kind ref through its route', (ref) => {
    expect(refFromRoute(router.resolve(routeForRef(ref)))).toEqual(ref)
    expect(parentForRef(ref)).toEqual({ route: '/gh/antfu/diffs', label: 'antfu/diffs' })
  })

  it('does not take a non-numeric segment for a pull request', () => {
    expect(router.resolve('/gh/antfu/diffs/main').name).toBeUndefined()
  })

  it('gives a paste no route and no parent', () => {
    expect(routeForRef({ kind: 'paste', hash: 'abc' })).toBeUndefined()
    expect(parentForRef({ kind: 'paste', hash: 'abc' })).toBeUndefined()
  })

  it('reads PR, compare, commit, repo and PR-list URLs from github.com', () => {
    expect(routeFromGithubUrl('https://github.com/antfu/diffs/pull/12/files')).toBe('/gh/antfu/diffs/12')
    expect(routeFromGithubUrl('https://github.com/antfu/diffs/compare/main...feat/x')).toBe('/gh/antfu/diffs/compare/main...feat/x')
    expect(routeFromGithubUrl('https://github.com/antfu/diffs/commit/a1b2c3d?diff=split')).toBe('/gh/antfu/diffs/commit/a1b2c3d')
    expect(routeFromGithubUrl('github.com/antfu/diffs')).toBe('/gh/antfu/diffs')
    expect(routeFromGithubUrl('https://github.com/antfu/diffs/pulls')).toBe('/gh/antfu/diffs')
    expect(routeFromGithubUrl('antfu/diffs#12')).toBe('/gh/antfu/diffs/12')
    expect(routeFromGithubUrl('https://github.com/antfu/diffs/compare/main')).toBeUndefined()
    expect(routeFromGithubUrl('https://example.com/antfu/diffs')).toBeUndefined()
  })
})

describe('gitlab source routes', () => {
  it.each<RoutableRef>([
    { kind: 'gitlab-mr', host: 'gitlab.com', project: 'group/sub/proj', iid: '12' },
    { kind: 'gitlab-mr', host: 'git.example.com:8443', project: 'a/b', iid: '3' },
    { kind: 'gitlab-compare', host: 'gitlab.com', project: 'a/b', base: 'main', head: 'feat/x' },
    { kind: 'gitlab-commit', host: 'self.host', project: 'g/s/p', sha: 'a1b2c3d4' },
  ])('round-trips a $kind ref through its route', (ref) => {
    expect(refFromRoute(router.resolve(routeForRef(ref)))).toEqual(ref)
  })

  it('links a merge request back to its project list', () => {
    expect(parentForRef({ kind: 'gitlab-mr', host: 'self.host', project: 'g/s/p', iid: '1' })).toEqual({ route: '/gl/self.host/g/s/p', label: 'g/s/p' })
    expect(routeFromUrl('https://self.host/g/s/p/-/merge_requests')).toBe('/gl/self.host/g/s/p')
    expect(listItemRoute({ host: 'self.host', project: 'g/p' }, { number: 3 })).toBe('/gl/self.host/g/p/-/merge_requests/3')
    expect(listItemLabel({ host: 'self.host', project: 'g/p' }, { number: 3 })).toBe('!3')
    expect(listItemLabel({ owner: 'o', repo: 'r' }, { number: 3 })).toBe('#3')
  })

  it('links a group\'s merge requests to their own projects', () => {
    const group = { host: 'self.host', project: 'team' }
    expect(listItemRoute(group, { number: 3, repository: 'team/sub/svc' })).toBe('/gl/self.host/team/sub/svc/-/merge_requests/3')
    expect(listItemLabel(group, { number: 3, repository: 'team/sub/svc' })).toBe('svc!3')
    expect(routeFromUrl('https://self.host/groups/team/-/merge_requests')).toBe('/gl/self.host/team')
    expect(router.resolve('/gl/self.host/team').name).toBeUndefined()
  })

  it('reads gitlab.com and self-hosted merge request URLs', () => {
    expect(routeFromUrl('https://gitlab.com/g/s/p/-/merge_requests/9')).toBe('/gl/gitlab.com/g/s/p/-/merge_requests/9')
    expect(routeFromUrl('https://gitlab1.program.com.tw/qa/tools/-/merge_requests/7/diffs')).toBe('/gl/gitlab1.program.com.tw/qa/tools/-/merge_requests/7')
    expect(routeFromUrl('https://github.com/antfu/diffs/pull/12')).toBe('/gh/antfu/diffs/12')
  })
})
