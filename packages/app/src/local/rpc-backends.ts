import type { Credentials, DiffSource } from '@pulls.review/core/types'
import type { Driver } from 'unstorage'
import type { LocalRpc } from './connection'
import { LOCAL_RPC } from '@pulls.review/core/local-rpc'
import { DiffsPayloadSchema } from '@pulls.review/core/types'
import * as v from 'valibot'

/** The server's cache directory as an unstorage driver: the browser's `CacheRepositories` run on it unchanged. */
export function createRpcDriver(rpc: LocalRpc): Driver {
  return {
    name: 'pulls-review-rpc',
    hasItem: async key => v.parse(v.nullable(v.string()), await rpc.call(LOCAL_RPC.storageGetItem, { key })) !== null,
    getItem: async key => v.parse(v.nullable(v.string()), await rpc.call(LOCAL_RPC.storageGetItem, { key })),
    setItem: async (key, value) => {
      await rpc.call(LOCAL_RPC.storageSetItem, { key, value })
    },
    removeItem: async (key) => {
      await rpc.call(LOCAL_RPC.storageRemoveItem, { key })
    },
    getKeys: async base => v.parse(v.array(v.string()), await rpc.call(LOCAL_RPC.storageGetKeys, { base })),
  }
}

/** The tokens the server found (environment, `gh` or `glab`), read once per page load and host; Settings fill in the rest. */
export function createRpcCredentials(rpc: LocalRpc, fallback: Credentials): Credentials {
  let token: Promise<string | undefined> | undefined
  const gitlabTokens = new Map<string, Promise<string | undefined>>()
  return {
    async githubToken() {
      token ??= rpc.call(LOCAL_RPC.githubToken).then(value => v.parse(v.optional(v.string()), value ?? undefined))
      return await token ?? fallback.githubToken()
    },
    async gitlabToken(host) {
      let pending = gitlabTokens.get(host)
      if (!pending) {
        pending = rpc.call(LOCAL_RPC.gitlabToken, { host }).then(value => v.parse(v.optional(v.string()), value ?? undefined))
        gitlabTokens.set(host, pending)
      }
      return await pending ?? fallback.gitlabToken?.(host)
    },
  }
}

/** A local diff, run by the server's `git`. Its target may still be resolving (a branch's base). */
export function createRpcSource(rpc: LocalRpc, pending: Promise<string>): DiffSource {
  return {
    key: async () => v.parse(v.string(), await rpc.call(LOCAL_RPC.sourceKey, { target: await pending })),
    fetch: async () => v.parse(DiffsPayloadSchema, await rpc.call(LOCAL_RPC.sourceFetch, { target: await pending })),
    fingerprint: async () => v.parse(v.string(), await rpc.call(LOCAL_RPC.sourceFingerprint, { target: await pending })),
    loadFile: async (path, sha) => v.parse(v.optional(v.string()), await rpc.call(LOCAL_RPC.sourceLoadFile, { target: await pending, path, sha }) ?? undefined),
  }
}
