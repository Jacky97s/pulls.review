import { describe, expect, it } from 'vitest'
import { parseHunks } from '../../patch-parser'
import { linePosition } from './line-position'

// Old lines 1-6 become new lines 1-7: line 3 replaced by two lines.
const hunks = parseHunks([
  '@@ -2,3 +2,4 @@',
  ' two',
  '-three',
  '+three a',
  '+three b',
  ' four',
])

describe('linePosition', () => {
  it('positions an added line by its new number only', () => {
    expect(linePosition(hunks, 'additions', 4)).toEqual({ new: 4, codeOld: 4, codeNew: 4 })
  })

  it('positions a removed line by its old number only', () => {
    expect(linePosition(hunks, 'deletions', 3)).toEqual({ old: 3, codeOld: 3, codeNew: 3 })
  })

  it('names both numbers for a context line inside a hunk', () => {
    expect(linePosition(hunks, 'additions', 5)).toMatchObject({ old: 4, new: 5 })
    expect(linePosition(hunks, 'deletions', 2)).toMatchObject({ old: 2, new: 2 })
  })

  it('shifts an unchanged line outside the hunks by what came before it', () => {
    expect(linePosition(hunks, 'additions', 1)).toMatchObject({ old: 1, new: 1 })
    expect(linePosition(hunks, 'additions', 7)).toMatchObject({ old: 6, new: 7 })
    expect(linePosition(hunks, 'deletions', 6)).toMatchObject({ old: 6, new: 7 })
  })
})
