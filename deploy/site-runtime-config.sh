#!/bin/sh
set -eu

provider="${PULLS_REVIEW_PROVIDER:-}"
api_key="${PULLS_REVIEW_API_KEY:-}"
model="${PULLS_REVIEW_MODEL:-}"
base_url="${PULLS_REVIEW_BASE_URL:-${OPENAI_BASE_URL:-}}"
locale="${PULLS_REVIEW_LOCALE:-}"

if [ -z "$provider" ]; then
  if [ -n "$api_key" ]; then
    # A provider-neutral key defaults to the gateway unless a provider is selected.
    provider=gateway
  elif [ -n "${AI_GATEWAY_API_KEY:-}" ]; then
    provider=gateway
  elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    provider=anthropic
  elif [ -n "${OPENAI_API_KEY:-}" ]; then
    provider=openai-compatible
  else
    # Keep the runtime config empty on an unconfigured install. The app still
    # uses its built-in gateway defaults, while legacy browser settings can migrate.
    provider=
  fi
fi

case "$provider" in
  gateway) api_key="${api_key:-${AI_GATEWAY_API_KEY:-}}" ;;
  anthropic) api_key="${api_key:-${ANTHROPIC_API_KEY:-}}" ;;
  openai-compatible) api_key="${api_key:-${OPENAI_API_KEY:-}}" ;;
  '') ;;
  *)
    echo "Unsupported PULLS_REVIEW_PROVIDER '$provider'; use gateway, anthropic, or openai-compatible." >&2
    exit 1
    ;;
esac

config=$(jq -cn \
  --arg provider "$provider" \
  --arg apiKey "$api_key" \
  --arg model "$model" \
  --arg baseUrl "$base_url" \
  --arg locale "$locale" \
  '{provider: $provider, apiKey: $apiKey, model: $model, baseUrl: $baseUrl, locale: $locale}')
printf 'window.__PULLS_REVIEW_CONFIG__ = %s;\n' "$config" > /usr/share/nginx/html/runtime-config.js
