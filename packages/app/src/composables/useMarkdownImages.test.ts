import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { imageSources, useMarkdownImages } from './useMarkdownImages'

describe('imageSources', () => {
  it('finds Markdown and HTML images, once each', () => {
    expect(imageSources('![a](/uploads/1/a.png) and ![b](/uploads/1/a.png "t") <img width="200" src="/uploads/2/b.png">'))
      .toEqual(['/uploads/1/a.png', '/uploads/2/b.png'])
  })
})

describe('useMarkdownImages', () => {
  it('swaps the images the source serves for blob URLs, and leaves the rest', async () => {
    const loader = vi.fn(async (src: string) => src.startsWith('/uploads/') ? new Blob(['x']) : undefined)
    const scope = effectScope()
    const body = ref('![a](/uploads/1/a.png) ![b](https://example.com/b.png)')
    const resolved = scope.run(() => useMarkdownImages(body, loader))!

    await vi.waitFor(() => expect(resolved.value).toMatch(/^!\[a\]\(blob:/))
    expect(resolved.value).toContain('https://example.com/b.png')

    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    scope.stop()
    expect(revoke).toHaveBeenCalledOnce()
  })

  it('keeps the original source when loading fails, and follows a changed body', async () => {
    const scope = effectScope()
    const body = ref('![a](/uploads/1/a.png)')
    const resolved = scope.run(() => useMarkdownImages(body, async () => {
      throw new Error('offline')
    }))!
    await nextTick()
    expect(resolved.value).toBe('![a](/uploads/1/a.png)')
    body.value = 'edited'
    await vi.waitFor(() => expect(resolved.value).toBe('edited'))
    scope.stop()
  })

  it('renders the body as is without a loader', () => {
    const scope = effectScope()
    expect(scope.run(() => useMarkdownImages('![a](/x.png)', undefined))!.value).toBe('![a](/x.png)')
    scope.stop()
  })
})
