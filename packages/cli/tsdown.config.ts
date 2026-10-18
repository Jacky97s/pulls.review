import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/devframe.ts'],
  platform: 'node',
  dts: false,
  // Bundled, so a release tarball installs on its own: the `@pulls.review/core` on npm is
  // upstream's, without this fork's GitLab support. Its own dependencies stay external.
  deps: { alwaysBundle: [/^@pulls\.review\/core(\/|$)/] },
})
