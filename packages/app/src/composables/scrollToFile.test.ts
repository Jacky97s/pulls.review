import { afterEach, describe, expect, it, vi } from 'vitest'
import { smoothScroll } from '../state/smooth-scroll'
import { scrollToAnchor, scrollToFile } from './scrollToFile'

function mountMarker() {
  const marker = document.createElement('div')
  marker.dataset.fileStart = 'abc'
  // Far below its scroll-margin, so a jump is needed.
  marker.getBoundingClientRect = () => ({ top: 500 }) as DOMRect
  marker.scrollIntoView = vi.fn()
  document.body.append(marker)
  return marker
}

describe('scrollToFile', () => {
  afterEach(() => {
    smoothScroll.value = true
    document.body.innerHTML = ''
  })

  it('animates the jump by default', () => {
    const marker = mountMarker()
    scrollToFile(document, 'abc')
    expect(marker.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('jumps right away with smooth scrolling turned off', () => {
    smoothScroll.value = false
    const marker = mountMarker()
    scrollToFile(document, 'abc')
    expect(marker.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
  })
})

describe('scrollToAnchor', () => {
  it('keeps re-aiming past five corrections on a long page', () => {
    const anchor = document.createElement('section')
    let top = 100_000
    anchor.getBoundingClientRect = () => ({ top }) as DOMRect
    anchor.scrollIntoView = vi.fn(() => {
      top = top > 1000 ? top / 2 : 0
    })
    document.body.append(anchor)

    scrollToAnchor(anchor)
    for (let i = 0; i < 12; i++)
      window.dispatchEvent(new Event('scrollend'))
    expect(top).toBe(0)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('re-aims after the scroll ends short, as content above grows during it', () => {
    const anchor = document.createElement('section')
    let top = 3000
    anchor.getBoundingClientRect = () => ({ top }) as DOMRect
    anchor.scrollIntoView = vi.fn(() => {
      top = 700
    })
    document.body.append(anchor)

    scrollToAnchor(anchor)
    window.dispatchEvent(new Event('scrollend'))
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(2)
    // Corrections jump: another smooth pass would end short again while content keeps growing.
    expect(anchor.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'start' })

    top = 0
    window.dispatchEvent(new Event('scrollend'))
    window.dispatchEvent(new Event('scrollend'))
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
