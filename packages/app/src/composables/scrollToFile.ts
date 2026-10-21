import { scrollBehavior } from '../state/smooth-scroll'

const MAX_CORRECTIONS = 20
const TOLERANCE_PX = 2
const pendingScrolls = new WeakMap<EventTarget, () => void>()

/** Input that means the user took over the scroll, so it must never be pulled back. */
const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
/** Corrections stop after this, whatever happens: a late `scrollend` would otherwise yank the page. */
const GIVE_UP_MS = 5000

/**
 * Scrolls (smoothly, unless turned off in Settings) until `anchor` sits at its
 * scroll-margin. Diffs above it render and grow while the scroll is in flight, so
 * each `scrollend` re-aims until it lands - by jumping, since another smooth pass would
 * end short again on a long page. The user scrolling, a newer jump, or the time limit
 * ends the corrections.
 */
export function scrollToAnchor(anchor: Element, root: ParentNode & EventTarget = anchor.ownerDocument) {
  const ownerDocument = anchor.ownerDocument
  const view = ownerDocument.defaultView ?? window

  // The embed scrolls within its drawer, below the toolbar. On the site, the
  // document scrollport starts at the viewport top instead.
  let scroller = anchor.parentElement
  while (scroller && scroller !== ownerDocument.scrollingElement && !/auto|scroll|overlay/.test(view.getComputedStyle(scroller).overflowY))
    scroller = scroller.parentElement
  if (scroller === ownerDocument.scrollingElement)
    scroller = null

  const scrollTarget: EventTarget = scroller ?? (root === ownerDocument ? view : root)
  const stopPrevious = pendingScrolls.get(scrollTarget)
  stopPrevious?.()
  const margin = Number.parseFloat(view.getComputedStyle(anchor).scrollMarginTop) || 0
  const isSettled = () => {
    const top = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0
    return Math.abs(anchor.getBoundingClientRect().top - top - margin) <= TOLERANCE_PX
  }

  let corrections = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  function stop() {
    scrollTarget.removeEventListener('scrollend', onScrollEnd, { capture: true })
    for (const type of USER_SCROLL_EVENTS)
      view.removeEventListener(type, stop, { capture: true })
    clearTimeout(timer)
    if (pendingScrolls.get(scrollTarget) === stop)
      pendingScrolls.delete(scrollTarget)
  }
  function onScrollEnd() {
    if (isSettled() || corrections++ >= MAX_CORRECTIONS) {
      stop()
      return
    }
    anchor.scrollIntoView({ behavior: 'instant', block: 'start' })
  }

  if (isSettled()) {
    // A new command also aborts the previous native smooth-scroll animation.
    if (stopPrevious)
      anchor.scrollIntoView({ behavior: 'instant', block: 'start' })
    return
  }

  pendingScrolls.set(scrollTarget, stop)
  scrollTarget.addEventListener('scrollend', onScrollEnd, { capture: true })
  for (const type of USER_SCROLL_EVENTS)
    view.addEventListener(type, stop, { capture: true, passive: true })
  timer = setTimeout(stop, GIVE_UP_MS)
  anchor.scrollIntoView({ behavior: scrollBehavior.value, block: 'start' })
}

/** Scrolls to a file's non-sticky `[data-file-start]` marker: its own header is sticky, so its rect doesn't follow the file once stuck. */
export function scrollToFile(root: ParentNode & EventTarget, sha: string) {
  const marker = root.querySelector(`[data-file-start="${sha}"]`)
  if (marker)
    scrollToAnchor(marker, root)
}
