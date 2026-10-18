<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/app/public/og-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./packages/app/public/og.png">
  <img alt="pulls.review Open Graph image" src="./packages/app/public/og.png">
</picture>

# [pulls.review](https://pulls.review)

> [!WARNING]
> Heavily work in progress.

Pull request review made simple. Groups changed files, summarizes what matters, and reviews them one scope at a time.

## Use on Website

To use pulls.review on the website, simply visit [pulls.review](https://pulls.review) and follow the instructions to connect your GitHub account and start reviewing pull requests directly in your browser.

## Install the CLI

The CLI reviews local git changes, GitHub pull requests and GitLab merge requests from your own machine. Install the latest release (Node.js 20 or later):

```bash
npm i -g https://github.com/Jacky97s/pulls.review/releases/latest/download/pulls.review.tgz
```

A specific version is `.../releases/download/v<version>/pulls.review.tgz`. Then run it inside any git repository:

```bash
pulls.review                    # the current branch against the default branch
pulls.review --worktree         # uncommitted changes
pulls.review https://gitlab.example.com/group/project/-/merge_requests/12
```

It reads GitHub tokens from `GITHUB_TOKEN` or `gh`, and GitLab tokens from `GITLAB_TOKEN` (for the host in `GITLAB_HOST`, default gitlab.com) or `glab`. On first start it prints an auth code that the browser asks for once. `pulls.review --help` lists every option.

To run it from a checkout instead: `pnpm install && pnpm -F @pulls.review/core build && pnpm -F pulls.review build`, then `node packages/cli/bin.mjs`.

## Review tips

**Find your way in**

- **Paste any link.** The box on the home page takes a GitHub pull request, compare or commit URL, `owner/repo#123`, or a GitLab merge request, compare, commit or project URL from gitlab.com or a self-hosted instance (`group/project!123` for gitlab.com). A repository or project URL opens its list of open requests.
- **Start with the first group.** Groups are ordered by review priority: the core change first, supporting changes next, mechanical changes (lockfiles, generated files, formatting) last. Read one group end to end before moving on.
- **Look for "Review carefully".** AI analysis marks the groups, files and lines that deserve extra care - security, data loss, hard-to-revert changes. Read those first, then the file and line notes, which explain what you would otherwise have to work out yourself.

**Choose the analysis**

- **Rules or AI.** _Rules_ groups by file path, instantly and for free. _AI_ groups by intent and adds summaries and notes; set a model in Settings → AI Analysis. Switch between them from the header at any time.
- **Ask, or regroup.** After an AI analysis, use the chat to ask about the change ("why does this touch the cache?", "what breaks if this is reverted?"), or to reshape it ("put the migration in its own group"); the grouping updates in place.
- **Share the analysis.** _Share result_ posts it as a comment (GitHub) or note (GitLab) on the request. Teammates who open the request load it from there instead of running a model again; a link with `?from=<user>` opens someone's shared analysis directly.

**Keep your place**

- **Mark files reviewed.** Tick the box on a file (or a whole folder in the file tree) once you've read it: it collapses, and the progress ring shows how far you are. _Review progress_ can mark everything, reset, or invert.
- **Re-review only what changed.** When new commits arrive, a reviewed file that changed is flagged "changed since review" - everything else stays done.
- **Step through commits.** For a request built as a series of focused commits, the commit selector shows one commit at a time; _Back to all changes_ returns to the whole diff.

**Comment like on GitHub or GitLab**

- **Comment on a range.** Drag across line numbers to select lines, then click **+**. The composer shows the lines it covers, and hovering a range thread highlights them in the diff.
- **Batch your comments.** _Start a review_ keeps comments pending until you submit them with Comment, Approve or Request changes, as on the host itself. `⌘/Ctrl + Enter` submits a comment or reply.
- **Write access.** Comments need a GitHub token with write access, or a GitLab token or sign-in with the `api` scope; with read-only access the threads stay visible but the composer is hidden.

**Read the code, not just the hunk**

- **Expand context.** Click "N unmodified lines" to see what surrounds a hunk, or load the full file from the file header. Files GitLab collapses for size load as you scroll to them.
- **Pick the layout.** Split or unified view, line wrapping and the syntax theme are in Settings → Appearance. A file that only adds or only removes lines, or a narrow window, always shows unified.

**Review before you push**

- Run the CLI (`packages/cli`) in a repository to review local work the same way: with no argument it opens the current branch against the default branch, `--worktree` opens uncommitted changes, and a request URL opens that request with the token from `gh` or `glab`.

## Use in GitHub

You can optionally install userscript to enhance the GitHub interface with pulls.review features.

Go to [pulls.review](https://pulls.review/) and scroll down to the GitHub section to install the userscript.

## Analyze pull requests from CI (Experimental)

Instead of each reviewer spending their own model key, let a workflow analyze every pull request once and post the result as a PR comment. pulls.review picks the comment up automatically for everyone who opens the PR there. Re-runs on an unchanged PR skip the model call.

```yaml
# .github/workflows/pulls-review.yml
name: pulls.review
on:
  # The analysis only reads the diff through the API and never checks out PR code,
  # so `pull_request_target` is safe here and lets fork PRs get a comment too.
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: Jacky97s/pulls.review@main
        with:
          api-key: ${{ secrets.VERCEL_AI_GATEWAY_API_KEY }}
```

`provider` is inferred from the key you pass (`gateway` for a Vercel AI Gateway token, `anthropic`, or `openai-compatible` with `base-url`); set it explicitly, along with `model` and `locale`, when you want to.

The action is a thin wrapper around the `@pulls.review/actions` CLI, which works anywhere a GitHub token and a model key are in the environment:

```sh
GITHUB_TOKEN=... ANTHROPIC_API_KEY=... npx @pulls.review/actions owner/repo#123
```

Every variable also has a `PULLS_REVIEW_*` form that takes precedence (`PULLS_REVIEW_GITHUB_TOKEN`, `PULLS_REVIEW_PROVIDER`, `PULLS_REVIEW_API_KEY`, `PULLS_REVIEW_MODEL`, `PULLS_REVIEW_BASE_URL`, `PULLS_REVIEW_LOCALE`); `npx @pulls.review/actions --help` lists everything.

## Self-host with Docker

The site is a static SPA with no backend, so it deploys as one nginx container:

```bash
VITE_GITLAB_OAUTH_CLIENTS=gitlab.example.com=<application id> \
GIT_SHA=$(git rev-parse --short HEAD) PORT=8080 \
docker compose up -d --build
```

- `VITE_GITLAB_OAUTH_CLIENTS` (optional): `host=id` pairs, comma-separated, for "Sign in with GitLab". Register the application on that instance as **not confidential**, scope `api`, redirect URI `https://<this site>/oauth/gitlab`. It is built into the bundle, so rebuild after changing it.
- Without it, users paste a personal access token per instance in Settings → GitLab.
- The browser calls each GitLab instance directly, so the instance must allow CORS from this site (GitLab's API does by default).

To analyze every GitLab merge request in CI, build the CLI image (`docker build --target actions -t <registry>/pulls-review-actions .`), push it to a registry the runners can pull from, and include [`deploy/pulls-review.gitlab-ci.yml`](./deploy/pulls-review.gitlab-ci.yml) - its header lists the CI/CD variables it needs.

## Packages

| Package                                       | What it is                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`packages/app`](./packages/app)              | The site at [pulls.review](https://pulls.review) and the github.com embed.             |
| [`@pulls.review/core`](./packages/core)       | Fetching, parsing, grouping and summarizing diffs - runs in the browser and in Node.   |
| [`@pulls.review/actions`](./packages/actions) | The CLI the GitHub Action runs.                                                        |
| [`pulls.review`](./packages/cli)              | The standalone CLI: local git changes, GitHub pull requests and GitLab merge requests. |

## Credits

Inspired heavily by [Linear's PR review guides](https://linear.app/docs/diffs#guides), thanks for the inspiration.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg" alt="Sponsors"/>
  </a>
</p>

## License

MIT License
