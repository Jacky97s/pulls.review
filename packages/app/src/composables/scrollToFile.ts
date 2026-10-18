import { scrollBehavior } from '../state/smooth-scroll'

const MAX_CORRECTIONS = 20
const TOLERANCE_PX = 2

/** Input that means the user took over the scroll, so it must never be pulled back. */
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
/** Corrections stop after this, whatever happens: a late `scrollend` would otherwise yank the page. */
const GIVE_UP_MS = 5000

let cancelPending: (() => void) | undefined

/**
 * Scrolls (smoothly, unless turned off in Settings) until `anchor` sits at its
 * scroll-margin. Diffs above it render and grow while the scroll is in flight, so
 * each `scrollend` re-aims until it lands - by jumping, since another smooth pass would
 * end short again on a long page. The user scrolling, a newer jump, or the time limit
 * ends the corrections.
 */
export function scrollToAnchor(anchor: Element) {
  cancelPending?.()
  const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
  const isSettled = () => Math.abs(anchor.getBoundingClientRect().top - margin) <= TOLERANCE_PX

  let corrections = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  function stop() {
    window.removeEventListener('scrollend', onScrollEnd, { capture: true })
    for (const type of USER_SCROLL_EVENTS)
      window.removeEventListener(type, stop, { capture: true })
    clearTimeout(timer)
    if (cancelPending === stop)
      cancelPending = undefined
  }
  function onScrollEnd() {
    if (isSettled() || corrections++ >= MAX_CORRECTIONS)
      return stop()
    anchor.scrollIntoView({ behavior: 'instant', block: 'start' })
  }

  if (isSettled())
    return
  window.addEventListener('scrollend', onScrollEnd, { capture: true })
  for (const type of USER_SCROLL_EVENTS)
    window.addEventListener(type, stop, { capture: true, passive: true })
  timer = setTimeout(stop, GIVE_UP_MS)
  cancelPending = stop
  anchor.scrollIntoView({ behavior: scrollBehavior.value, block: 'start' })
}

/** Scrolls to a file's non-sticky `[data-file-start]` marker: its own header is sticky, so its rect doesn't follow the file once stuck. */
export function scrollToFile(root: ParentNode, sha: string) {
  const marker = root.querySelector(`[data-file-start="${sha}"]`)
  if (marker)
    scrollToAnchor(marker)
}
