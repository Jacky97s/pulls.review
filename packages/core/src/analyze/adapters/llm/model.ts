import type { Api, Model, ThinkingLevel } from '@earendil-works/pi-ai'
import type { LlmSettings, OpenaiReasoning } from './settings'

export interface ResolvedModel {
  model: Model<Api>
  apiKey: string
  /** The effort every request asks for; absent sends none, or `off` where the model maps it. */
  reasoning?: ThinkingLevel
}

function customModel(id: string, api: Api, provider: string, baseUrl: string): Model<Api> {
  return {
    id,
    name: id,
    api,
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_000,
  }
}

/** OpenAI models that reason unless told not to: gpt-5.4 and later, gpt-6 and later. */
const REASONS_BY_DEFAULT = /(?:^|\/)gpt-(?:5\.(?:[4-9]|\d{2,})|[6-9]|\d{2,})(?:[.-]|$)/

/** Lets pi-ai send an effort: `off` maps to OpenAI's `none`, and `xhigh` is opted into. */
function withReasoning(model: Model<Api>): Model<Api> {
  return { ...model, reasoning: true, thinkingLevelMap: { off: 'none', xhigh: 'xhigh' } }
}

/**
 * Chat completions refuses function tools while a model reasons, and newer OpenAI
 * models reason by default. OpenAI itself gets the Responses API, which allows both;
 * any other endpoint may lack `/responses`, so there reasoning defaults to off for
 * those models.
 */
function openaiCompatibleModel(id: string, baseUrl: string, reasoning: OpenaiReasoning): ResolvedModel['model'] {
  if (new URL(baseUrl).host === 'api.openai.com') {
    const model = customModel(id, 'openai-responses', 'openai', baseUrl)
    return reasoning === 'default' ? model : withReasoning(model)
  }
  const model = customModel(id, 'openai-completions', 'openai-compatible', baseUrl)
  if (reasoning === 'default' && !REASONS_BY_DEFAULT.test(id))
    return model
  return { ...withReasoning(model), compat: { supportsReasoningEffort: true } } as Model<Api>
}

/**
 * Resolves the model to call: only the explicitly selected provider is used,
 * even when several tokens are configured. `undefined` means the selected
 * provider has no token - or is a local agent, which is never called directly.
 */
export function resolveModel(llm: LlmSettings): ResolvedModel | undefined {
  switch (llm.provider) {
    case 'local-agent':
      return undefined

    case 'gateway':
      return llm.gatewayToken
        ? { model: customModel(llm.gatewayModel, 'anthropic-messages', 'vercel-ai-gateway', 'https://ai-gateway.vercel.sh'), apiKey: llm.gatewayToken }
        : undefined

    case 'anthropic':
      return llm.anthropicApiKey
        ? { model: customModel(llm.anthropicModel, 'anthropic-messages', 'anthropic', 'https://api.anthropic.com'), apiKey: llm.anthropicApiKey }
        : undefined

    case 'openai-compatible':
      return llm.openaiApiKey
        ? {
            model: openaiCompatibleModel(llm.openaiModel, llm.openaiBaseUrl, llm.openaiReasoning),
            apiKey: llm.openaiApiKey,
            reasoning: llm.openaiReasoning === 'default' || llm.openaiReasoning === 'off' ? undefined : llm.openaiReasoning,
          }
        : undefined
  }
}
