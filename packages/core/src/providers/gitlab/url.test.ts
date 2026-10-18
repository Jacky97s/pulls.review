import { describe, expect, it } from 'vitest'
import { parseGitlabUrl } from './url'

describe('parseGitlabUrl', () => {
  it('reads a gitlab.com merge request with nested groups', () => {
    expect(parseGitlabUrl('https://gitlab.com/group/sub/proj/-/merge_requests/12/diffs')).toEqual({ kind: 'gitlab-mr', host: 'gitlab.com', project: 'group/sub/proj', iid: '12' })
  })

  it('reads a self-hosted merge request, keeping a port in the host', () => {
    expect(parseGitlabUrl('https://gitlab1.program.com.tw/qa/tools/-/merge_requests/7')).toEqual({ kind: 'gitlab-mr', host: 'gitlab1.program.com.tw', project: 'qa/tools', iid: '7' })
    expect(parseGitlabUrl('git.example.com:8443/a/b/-/merge_requests/3')).toEqual({ kind: 'gitlab-mr', host: 'git.example.com:8443', project: 'a/b', iid: '3' })
  })

  it('reads commits and compares', () => {
    expect(parseGitlabUrl('https://gitlab.com/a/b/-/commit/abc123')).toEqual({ kind: 'gitlab-commit', host: 'gitlab.com', project: 'a/b', sha: 'abc123' })
    expect(parseGitlabUrl('https://gitlab.com/a/b/-/compare/main...feat/x')).toEqual({ kind: 'gitlab-compare', host: 'gitlab.com', project: 'a/b', base: 'main', head: 'feat/x' })
  })

  it('reads a project, or its merge request list', () => {
    expect(parseGitlabUrl('https://gitlab.com/a/b')).toEqual({ kind: 'gitlab-project', host: 'gitlab.com', project: 'a/b' })
    expect(parseGitlabUrl('https://self.host/a/b/-/merge_requests')).toEqual({ kind: 'gitlab-project', host: 'self.host', project: 'a/b' })
  })

  it('reads the group/project!iid shorthand as gitlab.com', () => {
    expect(parseGitlabUrl('group/sub/proj!42')).toEqual({ kind: 'gitlab-mr', host: 'gitlab.com', project: 'group/sub/proj', iid: '42' })
  })

  it('refuses github.com and self-hosted URLs without the /-/ separator', () => {
    expect(parseGitlabUrl('https://github.com/a/b/pull/1')).toBeUndefined()
    expect(parseGitlabUrl('https://self.host/a/b')).toBeUndefined()
    expect(parseGitlabUrl('owner/repo#1')).toBeUndefined()
  })
})
