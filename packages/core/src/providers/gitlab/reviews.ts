import type { CommentAuthor, CommentThread, ReviewComment, ReviewData, ReviewDraftTarget, ReviewSummary } from '../../types/comment-threads'
import type { FileChange } from '../../types/diff'
import type { ReviewsApi, Viewer } from '../../types/source'
import type { GitlabMergeRequestJson } from './api'
import type { GitlabClient } from './client'
import { diagnostics } from '../../diagnostics'
import { fetchMergeRequest } from './api'
import { GitlabApiError, projectPath } from './client'
import { linePosition } from './line-position'

interface GitlabUserJson {
  username: string
  avatar_url?: string | null
}

interface GitlabPositionJson {
  head_sha: string
  old_path: string
  new_path: string
  old_line: number | null
  new_line: number | null
  line_range?: { start: { old_line: number | null, new_line: number | null }, end: { old_line: number | null, new_line: number | null } } | null
}

interface GitlabNoteJson {
  id: number
  type: string | null
  body: string
  author: GitlabUserJson | null
  created_at: string
  system: boolean
  resolvable?: boolean
  resolved?: boolean
  position?: GitlabPositionJson | null
}

export interface GitlabDiscussionJson {
  id: string
  notes: GitlabNoteJson[]
}

export interface GitlabDraftNoteJson {
  id: number
  discussion_id: string | null
  note: string
  position: GitlabPositionJson | null
}

interface GitlabReviewerJson {
  user: GitlabUserJson
  state: string
}

function author(user: GitlabUserJson | null | undefined): CommentAuthor | undefined {
  // `''`: a GitLab username is not a GitHub login, so no avatar may be looked up by name.
  return user ? { login: user.username, avatarUrl: user.avatar_url ?? '' } : undefined
}

/**
 * GitLab discussions, the viewer's draft notes and the reviewers' states as the
 * canonical `ReviewData`. Draft notes get negative ids so the writes can tell them
 * from published notes, whose ids live in a separate table.
 */
export function normalizeGitlabReviews(input: {
  mr: Pick<GitlabMergeRequestJson, 'web_url' | 'diff_refs' | 'sha'>
  discussions: GitlabDiscussionJson[]
  drafts: GitlabDraftNoteJson[]
  reviewers: GitlabReviewerJson[]
  viewer?: CommentAuthor
}): ReviewData {
  const headSha = input.mr.diff_refs?.head_sha ?? input.mr.sha
  const threads: CommentThread[] = []
  const byDiscussion = new Map<string, CommentThread>()

  function anchor(position: GitlabPositionJson): Pick<CommentThread, 'path' | 'side' | 'line' | 'startLine' | 'startSide'> {
    const side = position.new_line != null ? 'additions' : 'deletions'
    const start = position.line_range?.start
    const startSide = start ? (start.new_line != null ? 'additions' : 'deletions') : undefined
    const startLine = start ? (start.new_line ?? start.old_line ?? undefined) : undefined
    const line = position.new_line ?? position.old_line ?? undefined
    return {
      path: position.new_path ?? position.old_path,
      side,
      line,
      ...(startLine !== undefined && (startLine !== line || startSide !== side) && { startLine, startSide }),
    }
  }

  for (const discussion of input.discussions) {
    const [root] = discussion.notes
    if (!root || root.type !== 'DiffNote' || !root.position)
      continue
    const { line, ...placed } = anchor(root.position)
    const outdated = root.position.head_sha !== headSha
    const thread: CommentThread = {
      rootId: root.id,
      ...placed,
      line: outdated ? undefined : line,
      outdated,
      resolved: root.resolvable ? !!root.resolved : undefined,
      threadId: discussion.id,
      pending: false,
      comments: discussion.notes.filter(note => !note.system).map((note): ReviewComment => ({
        id: note.id,
        author: author(note.author),
        body: note.body,
        createdAt: note.created_at,
        url: `${input.mr.web_url}#note_${note.id}`,
        pending: false,
      })),
    }
    threads.push(thread)
    byDiscussion.set(discussion.id, thread)
  }

  for (const draft of input.drafts) {
    const comment: ReviewComment = { id: -draft.id, author: input.viewer, body: draft.note, createdAt: '', pending: true }
    const parent = draft.discussion_id ? byDiscussion.get(draft.discussion_id) : undefined
    if (parent) {
      parent.comments.push(comment)
      continue
    }
    if (!draft.position)
      continue
    threads.push({ rootId: -draft.id, ...anchor(draft.position), outdated: false, pending: true, comments: [comment] })
  }

  const summaries: ReviewSummary[] = input.reviewers
    .filter(reviewer => reviewer.state === 'approved' || reviewer.state === 'requested_changes')
    .map((reviewer, index) => ({
      id: index + 1,
      author: author(reviewer.user),
      state: reviewer.state === 'approved' ? 'approved' : 'changes_requested',
      body: '',
    }))

  return {
    threads,
    summaries,
    // GitLab has no review object: the viewer's draft notes are the pending review.
    pendingReview: input.drafts.length ? { id: 0, nodeId: '', body: '' } : undefined,
  }
}

/** A 403 on a write means the token may not write here, e.g. one with only `read_api`. */
async function asWrite<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  }
  catch (err) {
    throw err instanceof GitlabApiError && err.status === 403 ? diagnostics.writeForbidden({ reason: err.message }) : err
  }
}

async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Scopes that let a token write notes; `read_api` alone only reads. */
const WRITE_SCOPES = ['api']

/**
 * Who the token belongs to, and whether its scopes allow writing: a personal access
 * token reports them at `/personal_access_tokens/self`, an OAuth token at
 * `/oauth/token/info`. When neither answers, writing stays allowed and a refusal
 * surfaces as `writeForbidden`.
 */
export async function fetchGitlabViewer(client: GitlabClient): Promise<Viewer | undefined> {
  if (!await client.token())
    return undefined
  const user: GitlabUserJson = await (await client.request('/user')).json()
  const scopes = await client.request('/personal_access_tokens/self')
    .then(async res => ((await res.json()) as { scopes: string[] }).scopes)
    .catch(async () => {
      const res = await fetch(`https://${client.host}/oauth/token/info`, { headers: { Authorization: `Bearer ${await client.token()}` } })
      return res.ok ? ((await res.json()) as { scope: string[] }).scope : undefined
    })
    .catch(() => undefined)
  return { login: user.username, canWrite: !scopes || scopes.some(scope => WRITE_SCOPES.includes(scope)) }
}

export function createGitlabReviewsApi(
  client: GitlabClient,
  { project, iid }: { project: string, iid: string },
  { files }: { files: () => Promise<FileChange[]> },
): ReviewsApi {
  const mrPath = `${projectPath(project)}/merge_requests/${iid}`
  /** A thread's root note id to its discussion, for replies; refreshed by every `fetch`. */
  const discussionOf = new Map<number, string>()

  async function viewerAuthor(): Promise<CommentAuthor | undefined> {
    if (!await client.token())
      return undefined
    return author(await (await client.request('/user')).json() as GitlabUserJson)
  }

  async function position(target: ReviewDraftTarget) {
    const [mr, changes] = await Promise.all([fetchMergeRequest(client, project, iid), files()])
    const refs = mr.diff_refs
    if (!refs)
      throw new Error('This merge request has no diff to comment on yet.')
    const file = changes.find(change => change.path === target.path)
    const hunks = file?.hunks ?? []
    const end = linePosition(hunks, target.side, target.line)
    const oldPath = file?.previousPath ?? target.path
    const base = {
      position_type: 'text',
      base_sha: refs.base_sha,
      start_sha: refs.start_sha,
      head_sha: refs.head_sha,
      old_path: oldPath,
      new_path: target.path,
      old_line: end.old,
      new_line: end.new,
    }
    if (target.startLine === undefined)
      return base
    const start = linePosition(hunks, target.startSide ?? target.side, target.startLine)
    const fileHash = await sha1(target.path)
    const point = (at: typeof start) => ({
      line_code: `${fileHash}_${at.codeOld}_${at.codeNew}`,
      type: at.old === undefined ? 'new' : 'old',
      old_line: at.old,
      new_line: at.new,
    })
    return { ...base, line_range: { start: point(start), end: point(end) } }
  }

  return {
    async fetch() {
      const [mr, discussions, drafts, reviewers, viewer] = await Promise.all([
        fetchMergeRequest(client, project, iid),
        client.paginate<GitlabDiscussionJson>(`${mrPath}/discussions`),
        // Drafts are the viewer's own and need a token; anonymous viewers have none.
        (await client.token()) ? client.paginate<GitlabDraftNoteJson>(`${mrPath}/draft_notes`).catch(() => []) : Promise.resolve([]),
        // Reviewer states arrived in later GitLab versions; an older instance answers with something else.
        client.request(`${mrPath}/reviewers`).then(async (res) => {
          const json: unknown = await res.json()
          return Array.isArray(json) ? json as GitlabReviewerJson[] : []
        }).catch(() => []),
        viewerAuthor().catch(() => undefined),
      ])
      discussionOf.clear()
      for (const discussion of discussions) {
        if (discussion.notes[0])
          discussionOf.set(discussion.notes[0].id, discussion.id)
      }
      return normalizeGitlabReviews({ mr, discussions, drafts, reviewers, viewer })
    },
    addComment: ({ target, body, mode }) => asWrite(async () => {
      const at = await position(target)
      if (mode === 'review')
        await client.request(`${mrPath}/draft_notes`, { method: 'POST', body: { note: body, position: at } })
      else
        await client.request(`${mrPath}/discussions`, { method: 'POST', body: { body, position: at } })
    }),
    reply: (rootCommentId, body) => asWrite(async () => {
      const discussion = discussionOf.get(rootCommentId)
      if (!discussion)
        throw new Error('Submit your review before replying to its comments.')
      await client.request(`${mrPath}/discussions/${discussion}/notes`, { method: 'POST', body: { body } })
    }),
    editComment: (commentId, body) => asWrite(async () => {
      await (commentId < 0
        ? client.request(`${mrPath}/draft_notes/${-commentId}`, { method: 'PUT', body: { note: body } })
        : client.request(`${mrPath}/notes/${commentId}`, { method: 'PUT', body: { body } }))
    }),
    deleteComment: commentId => asWrite(async () => {
      await client.request(commentId < 0 ? `${mrPath}/draft_notes/${-commentId}` : `${mrPath}/notes/${commentId}`, { method: 'DELETE' })
    }),
    resolveThread: threadId => asWrite(async () => {
      await client.request(`${mrPath}/discussions/${threadId}`, { method: 'PUT', body: { resolved: true } })
    }),
    submitReview: (verdict, body, pendingReview) => asWrite(async () => {
      if (pendingReview || verdict === 'REQUEST_CHANGES') {
        await client.request(`${mrPath}/draft_notes/bulk_publish`, {
          method: 'POST',
          body: { note: body || undefined, reviewer_state: verdict === 'REQUEST_CHANGES' ? 'requested_changes' : undefined },
        })
      }
      else if (body) {
        await client.request(`${mrPath}/notes`, { method: 'POST', body: { body } })
      }
      // Request changes doesn't block in GitLab; only an approval is recorded formally.
      if (verdict === 'APPROVE')
        await client.request(`${mrPath}/approve`, { method: 'POST', body: {} })
    }),
    discardPendingReview: () => asWrite(async () => {
      const drafts = await client.paginate<GitlabDraftNoteJson>(`${mrPath}/draft_notes`)
      await Promise.all(drafts.map(draft => client.request(`${mrPath}/draft_notes/${draft.id}`, { method: 'DELETE' })))
    }),
  }
}
