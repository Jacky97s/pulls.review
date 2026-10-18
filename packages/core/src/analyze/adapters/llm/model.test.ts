import type { OpenaiReasoning } from './settings'
import { normalizeContext, Type } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveModel } from './model'
import { createStreamFn } from './runtime'
import { defaultLlmSettings } from './settings'

/** The URL and JSON body of the first request a turn sends. */
async function firstRequest(openaiBaseUrl: string, openaiModel: string, openaiReasoning: OpenaiReasoning = 'default') {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('', { status: 500 }))
  vi.stubGlobal('fetch', fetchMock)
  const resolved = resolveModel({ ...defaultLlmSettings, provider: 'openai-compatible', openaiApiKey: 'k', openaiBaseUrl, openaiModel, openaiReasoning })!
  const context = normalizeContext({
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    tools: [{ name: 'read', description: 'Reads a file.', parameters: Type.Object({}) }],
  })
  const stream = await createStreamFn(resolved)(resolved.model, context, { apiKey: resolved.apiKey })
  await stream.result()
  const [url, init] = fetchMock.mock.calls[0]!
  return { url: String(url), body: JSON.parse(String(init?.body)) }
}

describe('openAI-compatible requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to gpt-6-luna', () => {
    expect(defaultLlmSettings.openaiModel).toBe('gpt-6-luna')
  })

  it('calls OpenAI itself through the Responses API, which allows tools while reasoning', async () => {
    const { url, body } = await firstRequest('https://api.openai.com/v1', 'gpt-6-luna')
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(body.reasoning).toBeUndefined()
    expect(body.tools).toHaveLength(1)
  })

  it('sends the chosen reasoning effort to the Responses API', async () => {
    expect((await firstRequest('https://api.openai.com/v1', 'gpt-6-luna', 'high')).body.reasoning).toMatchObject({ effort: 'high' })
    expect((await firstRequest('https://api.openai.com/v1', 'gpt-6-luna', 'off')).body.reasoning).toEqual({ effort: 'none' })
  })

  it('turns reasoning off on chat completions for models that reason by default', async () => {
    const { url, body } = await firstRequest('https://llm.internal/v1', 'gpt-5.6-luna')
    expect(url).toBe('https://llm.internal/v1/chat/completions')
    expect(body.reasoning_effort).toBe('none')
  })

  it('sends the chosen effort on chat completions', async () => {
    expect((await firstRequest('https://llm.internal/v1', 'qwen3', 'low')).body.reasoning_effort).toBe('low')
  })

  it('sends no reasoning parameter to other chat-completions models by default', async () => {
    expect((await firstRequest('http://localhost:11434/v1', 'llama3.3')).body.reasoning_effort).toBeUndefined()
    expect((await firstRequest('https://llm.internal/v1', 'gpt-4.1')).body.reasoning_effort).toBeUndefined()
  })
})
