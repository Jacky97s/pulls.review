import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticCredentials } from '../../types/source'
import { createGitlabClient } from './client'
import { fetchGitlabUpload, parseGitlabUpload } from './uploads'

const secret = 'fc204a2bbc173f1060adb9df207ab519'

describe('parseGitlabUpload', () => {
  it('reads the project-relative form GitLab writes into Markdown', () => {
    expect(parseGitlabUpload(`/uploads/${secret}/image.png`, 'self.host', 'g/p')).toEqual({ project: 'g/p', secret, filename: 'image.png' })
    expect(parseGitlabUpload(`/uploads/${secret}/my%20shot.png`, 'self.host', 'g/p')?.filename).toBe('my shot.png')
  })

  it('reads absolute upload URLs on the same instance, by path or by project id', () => {
    expect(parseGitlabUpload(`https://self.host/team/svc/uploads/${secret}/a.png`, 'self.host', 'g/p')).toEqual({ project: 'team/svc', secret, filename: 'a.png' })
    expect(parseGitlabUpload(`https://self.host/-/project/42/uploads/${secret}/a.png`, 'self.host', 'g/p')).toEqual({ project: '42', secret, filename: 'a.png' })
  })

  it('leaves other images, and other hosts\' uploads, to load as they are', () => {
    expect(parseGitlabUpload('https://example.com/a.png', 'self.host', 'g/p')).toBeUndefined()
    expect(parseGitlabUpload(`https://other.host/g/p/uploads/${secret}/a.png`, 'self.host', 'g/p')).toBeUndefined()
    expect(parseGitlabUpload('./docs/a.png', 'self.host', 'g/p')).toBeUndefined()
  })
})

describe('fetchGitlabUpload', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches through the API with the instance\'s token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('png-bytes'))
    vi.stubGlobal('fetch', fetchMock)
    const blob = await fetchGitlabUpload(createGitlabClient('self.host', staticCredentials(undefined, { 'self.host': 't' })), { project: 'g/p', secret, filename: 'my shot.png' })
    expect(await blob!.text()).toBe('png-bytes')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`https://self.host/api/v4/projects/g%2Fp/uploads/${secret}/my%20shot.png`)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer t')
  })

  it('is undefined when the upload is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: '404' }, { status: 404 })))
    expect(await fetchGitlabUpload(createGitlabClient('self.host'), { project: '42', secret, filename: 'a.png' })).toBeUndefined()
  })
})
