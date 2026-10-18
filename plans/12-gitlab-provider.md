# 12 - GitLab provider (gitlab.com and self-hosted)

GitLab merge requests, compares and commits sit next to GitHub's, from gitlab.com
or any self-hosted instance, on the site, the CLI and (later) GitLab CI.

## Decisions

- **Coexist with GitHub.** New `SourceRef` kinds `gitlab-mr { host, project, iid }`,
  `gitlab-compare`, `gitlab-commit`. `project` is the full namespace path (nested
  groups included); `host` is part of every ref and cache key
  (`gitlab:{host}/{project}!{iid}`), so two instances never share a key.
- **Per-host tokens.** `Credentials.gitlabToken(host)`; a token is only ever sent to
  the host it was saved for. Sent as `PRIVATE-TOKEN` to `https://{host}/api/v4`.
- **REST v4 only**, through one `GitlabClient` per host. MR diffs use the paginated
  `/merge_requests/:iid/diffs` endpoint (GitLab 15.7+). A diff GitLab drops for size
  (`too_large`/`collapsed`) becomes `FileChange.truncated` and loads on demand via
  `/files/:path/raw`; rebuilding them all up front rate-limits a large compare.
- **File versions.** Diff listings carry no blob sha, so `FileChange.sha` hashes the
  file's path and diff: unchanged across pushes that leave the file alone.
- **URLs.** `parseGitlabUrl` reads any instance's URL by GitLab's `/-/` separator;
  only gitlab.com accepts a bare project URL and the `group/project!iid` shorthand.
- **Browser access to self-hosted instances depends on that instance's CORS.** The
  no-backend invariant stands: the site calls the instance directly. A refused
  request surfaces as an error naming the host; the CLI is unaffected. GitLab's
  API answers CORS preflights for `PRIVATE-TOKEN` with `*` by default (checked on
  gitlab1.program.com.tw).
- **Sign-in (S2b).** A GitLab Application as a public client: authorization code +
  PKCE (S256), no client secret, scope `read_api`, redirect URI `<origin>/oauth/gitlab`.
  The client id per host comes from `VITE_GITLAB_OAUTH_CLIENTS` (`host=id,host=id`) at
  build time, or from Settings. The pending sign-in (state, verifier, return path) lives
  in `sessionStorage` and is spent on the first callback; the return path is limited to
  this site. Tokens are kept per host like a PAT and renewed one minute before expiry,
  once per host for concurrent requests; a refused refresh signs that host out. Every
  token is sent as `Authorization: Bearer`, which GitLab accepts for PATs too.
- **Target: company-internal open source.** The SPA is deployed on an internal host;
  self-hosted GitLab is the primary instance, gitlab.com stays supported.

## Slices

| ID | Outcome | Acceptance |
| -- | ------- | ---------- |
| S1 | Core: refs, credentials, client, MR/compare/commit sources, URL parser, `@pulls.review/core/gitlab` | co-located vitest; repo typecheck |
| S2 | App: `/gl/{host}/{project}/-/merge_requests/{iid}` (and compare/commit) routes, `source-routes`, per-host token settings, URL box accepts GitLab URLs, CORS error | dev server + browser on a gitlab.com MR and a self-hosted MR |
| S2b | Sign in with a GitLab Application (OAuth authorization code + PKCE, no client secret): per-host `clientId` from build-time config (one app registered by an admin for the internal deployment) or entered in Settings; refresh tokens kept per host | browser sign-in round trip on gitlab1; token refresh after expiry |
| S3 | Project MR list at `/gl/{host}/{project}` | browser |
| S4 | CLI accepts GitLab URLs; tokens from `GITLAB_TOKEN`/`GITLAB_HOST` | run the CLI |
| S5 | (deferred) Review threads: discussions, draft notes, approve | own plan |
| S6 | (deferred) Shared analysis as an MR note; GitLab CI job in place of `action.yml` | own plan |

Out of scope: a GitLab embed (browser extension).
