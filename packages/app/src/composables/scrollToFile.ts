import { scrollBehavior } from '../state/smooth-scroll'

const MAX_CORRECTIONS = 20
const TOLERANCE_PX = 2

/**
 * Scrolls (smoothly, unless turned off in Settings) until `anchor` sits at its
 * scroll-margin. Diffs above it render and grow while the scroll is in flight, so
 * each `scrollend` re-aims until it lands - by jumping, since another smooth pass would
 * end short again on a long page.
 */
export function scrollToAnchor(anchor: Element) {
  const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
  const isSettled = () => Math.abs(anchor.getBoundingClientRect().top - margin) <= TOLERANCE_PX

  let corrections = 0
  function onScrollEnd() {
    if (isSettled() || corrections++ >= MAX_CORRECTIONS) {
      window.removeEventListener('scrollend', onScrollEnd, { capture: true })
      return
    }
    anchor.scrollIntoView({ behavior: 'instant', block: 'start' })
  }

  if (isSettled())
    return
  window.addEventListener('scrollend', onScrollEnd, { capture: true })
  anchor.scrollIntoView({ behavior: scrollBehavior.value, block: 'start' })
}

/** Scrolls to a file's non-sticky `[data-file-start]` marker: its own header is sticky, so its rect doesn't follow the file once stuck. */
export function scrollToFile(root: ParentNode, sha: string) {
  const marker = root.querySelector(`[data-file-start="${sha}"]`)
  if (marker)
    scrollToAnchor(marker)
}
