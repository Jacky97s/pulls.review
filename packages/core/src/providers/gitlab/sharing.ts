import type { SharedAnalysisComment } from '../../types/shared-analysis'
import type { SharingApi } from '../../types/source'
import type { GitlabClient } from './client'
import { parseSharedAnalysisComment, renderSharedAnalysisBody } from '../github/shared-analysis-comment'
import { GitlabApiError, projectPath } from './client'
import { asWrite } from './reviews'

interface GitlabNoteJson {
  id: number
  body: string
  system: boolean
  author: { username: string } | null
  updated_at: string
}

export interface GitlabMergeRequestRef { host: string, project: string, iid: string }

/**
 * Shared analyses as merge request notes, in the format GitHub comments use, one per
 * user. The link names `siteOrigin`, the deployment readers open it on - an internal
 * one for a self-hosted instance.
 */
export function createGitlabSharingApi(client: GitlabClient, mr: GitlabMergeRequestRef, siteOrigin: string): SharingApi {
  const notesPath = `${projectPath(mr.project)}/merge_requests/${mr.iid}/notes`

  function noteUrl(id: number): string {
    return `https://${mr.host}/${mr.project}/-/merge_requests/${mr.iid}#note_${id}`
  }

  /** Newest first; the first 100 notes only - discovery is best-effort and stays one request. */
  async function list(): Promise<SharedAnalysisComment[]> {
    const notes: GitlabNoteJson[] = await (await client.request(`${notesPath}?per_page=100&sort=desc&order_by=updated_at`)).json()
    return notes.flatMap((note) => {
      const analysis = note.system ? undefined : parseSharedAnalysisComment(note.body)
      return analysis && note.author
        ? [{ id: note.id, login: note.author.username, url: noteUrl(note.id), updatedAt: note.updated_at, analysis }]
        : []
    })
  }

  async function write(method: 'POST' | 'PUT', path: string, body: string) {
    const note: GitlabNoteJson = await (await client.request(path, { method, body: { body } })).json()
    return { id: note.id, url: noteUrl(note.id) }
  }

  return {
    list,
    upsert: (login, analysis, remembered) => asWrite(async () => {
      const link = `${siteOrigin}/gl/${mr.host}/${mr.project}/-/merge_requests/${mr.iid}?from=${encodeURIComponent(login)}`
      const body = renderSharedAnalysisBody(link, analysis, 'merge request')
      if (remembered) {
        try {
          return await write('PUT', `${notesPath}/${remembered.id}`, body)
        }
        catch (err) {
          // The remembered note was deleted - fall through to the scan.
          if (!(err instanceof GitlabApiError && err.status === 404))
            throw err
        }
      }
      const existing = (await list()).find(entry => entry.login === login)
      return existing ? write('PUT', `${notesPath}/${existing.id}`, body) : write('POST', notesPath, body)
    }),
  }
}
