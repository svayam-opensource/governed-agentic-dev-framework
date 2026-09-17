# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov-install — the install site as a container, deployed by gov (catalog unit `gov-install`).
#
# Build context is this directory (`site/`, the unit's source.path). gov builds ONCE at dev and promotes the
# same image, so every environment in envs.json is built into it; caddyfile.mjs routes each request to its
# env's build by Host.
#
# WHY THE BUILD CLONES. build.mjs serves install.sh read from a PINNED REF (`git show <ref>:install.sh` —
# `uat`, `dev`, `gov-work-<semver>`), so it needs the remote branches and the tags. The deploy job's checkout
# is `--depth 1` on one branch, and copying its .git in would bake the job's access token into the image.
# The repository is public, so the build clones it anonymously — and then lays THIS context's site/ over the
# clone, so the page, envs.json and build.mjs are the commit being deployed, not the default branch's.
# FULLY QUALIFIED image names: the deploy agent builds with podman, which enforces short-name resolution and
# cannot prompt without a TTY — `caddy:2-alpine` failed there (Jenkins deploy/dev/gov-install #1), and `node`
# only resolved because it happens to be in the agent's alias list.
FROM docker.io/library/node:24-alpine AS build
RUN apk add --no-cache git
ARG REPO=https://github.com/svayam-opensource/governed-agentic-dev-framework.git
RUN git clone --quiet --no-single-branch "$REPO" /src
COPY . /src/site
WORKDIR /src
RUN set -e; \
    for e in $(node -p "Object.keys(require('./site/envs.json').envs).join(' ')"); do \
      node site/build.mjs "$e" --verify; \
    done; \
    node site/caddyfile.mjs site/dist > /src/Caddyfile

FROM docker.io/library/caddy:2-alpine
COPY --from=build /src/site/dist /srv
COPY --from=build /src/Caddyfile /etc/caddy/Caddyfile
EXPOSE 4002
