FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY . .
# No install scripts: the root `prepare` (skills-npm) sets up coding-agent skills and fails
# where no agent is installed; the build needs none of them.
RUN pnpm install --frozen-lockfile --ignore-scripts

# The CLI a GitLab CI job runs to analyze a merge request and post the result as a note
# (deploy/pulls-review.gitlab-ci.yml). No ENTRYPOINT: GitLab runs the job's script in a shell.
FROM deps AS actions
RUN pnpm -F @pulls.review/core run build && pnpm -F @pulls.review/actions run build \
  && printf '#!/bin/sh\nexec node /app/packages/actions/dist/index.mjs "$@"\n' > /usr/local/bin/pulls-review-actions \
  && chmod +x /usr/local/bin/pulls-review-actions

# The site is a static SPA with no backend: build it, then serve the files.
FROM deps AS build
# GitLab Applications users sign in through, as `host=clientId` pairs (see plans/12).
# Baked into the bundle: a client id is public, a public client has no secret.
ARG VITE_GITLAB_OAUTH_CLIENTS=""
ENV VITE_GITLAB_OAUTH_CLIENTS=$VITE_GITLAB_OAUTH_CLIENTS
# The build stamps a version from git, which the image doesn't carry.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
RUN pnpm -F @pulls.review/app run build

# Last, so a plain `docker build` produces the site.
FROM nginx:1.29-alpine AS site
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/app/dist /usr/share/nginx/html
EXPOSE 80
