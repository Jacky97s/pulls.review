import type { DiffSide } from '../../types/comment-threads'
import type { DiffHunk } from '../../types/diff'

/** A diff line as GitLab positions it: an added line has only `new`, a removed one only `old`, context both. */
export interface LinePosition {
  old?: number
  new?: number
  /** Both sides' counters at the line, which GitLab's `line_code` is built from even for added and removed lines. */
  codeOld: number
  codeNew: number
}

function positionAt(kind: string | undefined, oldNo: number, newNo: number): LinePosition {
  if (kind === '+')
    return { new: newNo, codeOld: oldNo, codeNew: newNo }
  if (kind === '-')
    return { old: oldNo, codeOld: oldNo, codeNew: newNo }
  return { old: oldNo, new: newNo, codeOld: oldNo, codeNew: newNo }
}

/** A removed line has no new-side number and an added line no old-side one. */
function isOnSide(kind: string | undefined, side: DiffSide): boolean {
  return kind === '+' ? side === 'additions' : kind !== '-' || side === 'deletions'
}

/** Walks one hunk: the line's position when the hunk holds it, else the counters past its end. */
function walkHunk(hunk: DiffHunk, side: DiffSide, line: number): LinePosition | { oldNo: number, newNo: number } {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  for (const text of hunk.patch.split('\n')) {
    const kind = text[0]
    if (kind === '\\')
      continue
    if (isOnSide(kind, side) && (side === 'additions' ? newNo : oldNo) === line)
      return positionAt(kind, oldNo, newNo)
    if (kind !== '+')
      oldNo++
    if (kind !== '-')
      newNo++
  }
  return { oldNo, newNo }
}

/**
 * Where `line` on `side` sits on both sides of a file's diff. GitLab refuses a note on
 * an unchanged line unless it names both numbers, and lines outside every hunk are
 * unchanged too, shifted by whatever the hunks above them added or removed.
 */
export function linePosition(hunks: DiffHunk[], side: DiffSide, line: number): LinePosition {
  // `new - old` for unchanged lines past the hunks walked so far.
  let shift = 0
  for (const hunk of hunks) {
    if (line < (side === 'additions' ? hunk.newStart : hunk.oldStart))
      break
    const walked = walkHunk(hunk, side, line)
    if ('codeOld' in walked)
      return walked
    shift = walked.newNo - walked.oldNo
  }
  return side === 'additions' ? positionAt(' ', line - shift, line) : positionAt(' ', line, line + shift)
}
