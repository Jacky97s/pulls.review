import { defineConfig } from '@x18n/core'

export default defineConfig({
  sourceLocale: 'en',
  resources: [
    {
      pattern: 'packages/app/src/i18n/locales/{locale}.{ext}',
    },
  ],
})
