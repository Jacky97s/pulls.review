import type { InjectionKey, MaybeRefOrGetter, Ref } from 'vue'
import { inject, onScopeDispose, ref, toValue, watch } from 'vue'

export type ImageLoader = (src: string) => Promise<Blob | undefined>

/** The diff's source, when it serves some Markdown images itself (see `DiffSource.loadImage`). */
export const markdownImageLoaderKey: InjectionKey<ImageLoader | undefined> = Symbol('markdown-image-loader')

/** `![alt](src "title")` and `<img src="...">`: the image sources a Markdown body names. */
const IMAGE_SOURCES = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\s(?:[^>]*\s)?src=["']([^"']+)["']/g

export function imageSources(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(IMAGE_SOURCES)].map(match => match[1] ?? match[2]!))]
}

/**
 * `markdown` with every image the source serves itself swapped for a blob URL - a private
 * host's uploads need its credentials, which an `<img>` can't send. Other images, and
 * images that fail to load, keep their original source. Blob URLs are revoked with the scope.
 */
export function useMarkdownImages(markdown: MaybeRefOrGetter<string>, loader = inject(markdownImageLoaderKey, undefined)): Ref<string> {
  const resolved = ref(toValue(markdown))
  const blobs = new Map<string, string>()

  watch(() => toValue(markdown), async (text) => {
    resolved.value = text
    if (!loader)
      return
    await Promise.all(imageSources(text).filter(src => !blobs.has(src)).map(async (src) => {
      const blob = await loader(src).catch(() => undefined)
      if (blob)
        blobs.set(src, URL.createObjectURL(blob))
    }))
    // A newer body may have arrived meanwhile; it gets its own pass.
    if (text === toValue(markdown))
      resolved.value = [...blobs].reduce((body, [src, url]) => body.replaceAll(src, url), text)
  }, { immediate: true })

  onScopeDispose(() => {
    for (const url of blobs.values())
      URL.revokeObjectURL(url)
  })
  return resolved
}
