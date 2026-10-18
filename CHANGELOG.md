# Changelog

Notable changes to this fork of [pulls.review](https://github.com/antfu/pulls.review). Each release's section here becomes its GitHub Release notes.

## [0.4.0] - 2026-10-18

GitLab support - gitlab.com and self-hosted instances - next to GitHub, for running pulls.review internally.

### Added

- **GitLab merge requests, compares and commits** at `/gl/{host}/{project}/-/merge_requests/{iid}` (and `compare`, `commit`), from gitlab.com or any self-hosted instance. Paste any GitLab URL, or `group/project!123` for gitlab.com.
- **Merge request lists for projects and groups** at `/gl/{host}/{path}`; a group's list covers its subgroups, and each row names its project.
- **Sign in with GitLab** through a GitLab Application (authorization code + PKCE, no backend), or a personal access token per instance. Configure applications with `VITE_GITLAB_OAUTH_CLIENTS` or in Settings → GitLab.
- **GitLab review threads**: comments on lines and ranges, replies, edits, resolve, draft reviews, approve and request changes. Writing needs the `api` scope.
- **Shared analyses as merge request notes**, linking back to your own deployment.
- **CLI** opens GitLab merge requests (`pulls.review <url>`), with tokens from `GITLAB_TOKEN`/`GITLAB_HOST` or `glab`.
- **GitLab CI**: `pulls-review-actions` analyzes the merge request of a pipeline; see `deploy/pulls-review.gitlab-ci.yml`.
- **Self-hosting with Docker**: `docker compose up -d --build` serves the site from nginx.
- **CLI from GitHub Releases**: `npm i -g https://github.com/Jacky97s/pulls.review/releases/latest/download/pulls.review.tgz`.
- **OpenAI reasoning setting** (Settings → AI Analysis), and `gpt-6-luna` as the default OpenAI model.
- Range comments say which lines they cover, and hovering one highlights them.
- Review tips in the README.

### Fixed

- Jumps to a group or the description stopped short while lazy diffs grew; they now land, and never pull back a manual scroll.
- Truncated files never showed after their content loaded, and were forced into the unified layout.
- OpenAI models that reason by default (gpt-5.4 and later) failed to call tools on chat completions.
- The analysis prompts called every diff a GitHub pull request; tool descriptions now state their limits, and Claude gets room for adaptive thinking.
- A GitLab username no longer pulls in the avatar of a same-named GitHub user.
- Images uploaded to a GitLab merge request (`/uploads/...`) now show in its description and comments: they load through the API with your token, since GitLab serves them only to a signed-in browser.

### Changed

- Releases go to GitHub Releases instead of npm: upstream owns the npm names, and its `@pulls.review/core` lacks GitLab support. The CLI bundles core.
- Project links point at `Jacky97s/pulls.review`.
