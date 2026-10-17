# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov-install — the install site as a container, deployed by gov (catalog unit `gov-install`).
#
# Build context: the repo root (`build.context: repo`) or this directory — both work, see the COPY below. gov
# builds ONCE at dev and promotes the same image, so every environment in envs.json is built into it;
# caddyfile.mjs routes each request to its env's build by Host. A LOCAL build adds a fourth, `local`.
#
# WHY THE BUILD CLONES. build.mjs serves install.sh read from a PINNED REF (`git show <ref>:install.sh` —
# `uat`, `dev`, `gov-work-<semver>`), so it needs the remote branches and the tags. The deploy job's checkout
# is `--depth 1` on one branch, and copying its .git in would bake the job's access token into the image.
# The repository is public, so the build clones it anonymously — and then REPLACES the clone's site/ with THIS
# context's, so the page, envs.json and build.mjs are the commit being deployed, not the default branch's.
# (Replaced, not overlaid: an overlay kept files the deployed commit had deleted.)
# FULLY QUALIFIED image names: the deploy agent builds with podman, which enforces short-name resolution and
# cannot prompt without a TTY — `caddy:2-alpine` failed there (Jenkins deploy/dev/gov-install #1), and `node`
# only resolved because it happens to be in the agent's alias list.
FROM docker.io/library/node:24-alpine AS build
RUN apk add --no-cache git
ARG REPO=https://github.com/svayam-opensource/governed-agentic-dev-framework.git
# WHAT THIS IMAGE'S DECLARED DEPS RESOLVE TO, passed by `gov deploy` from the catalog (PRJ-121).
#
# JSON, one entry per `deps:` edge on the gov-install unit: [{unit, package, semver, registries}]. What it
# decides is narrower than it looks: for uat and dev, the package NAME and the env's REGISTRY. The version is
# NOT taken from it — non-prod asks for its own dist-tag (`@dev`, `@uat`), because the dev build's version is
# only known once it publishes; and prod is a RELEASE PAIR in envs.json that moves only after a release. So
# the catalog `semver` travels in this arg and is deliberately unused. See build.mjs for both reasons.
#
# EMPTY IS A VALID BUILD, and stays valid deliberately. A local `docker build` for a quick page check has no
# gov deploy behind it, and must not need one; build.mjs then falls back to the pins written in envs.json.
# gov always passes it, so the deployed image is never the fallback.
ARG GOV_DEPS=
# THIS BUILD IS THE LOCAL SANDBOX (PRJ-121, 2026-09-21). Set only by `gov-cicd deploy gov-install --env local` —
# a local image is never pushed or promoted, so it is the one build allowed to know its env. It adds a `local`
# site built from the WORKTREE: its install.sh, and a client packed from its publish/actions/ts, served at
# /gov.tgz. Nothing a shared env builds ever sets it. See site/build-local.mjs.
ARG GOV_LOCAL=
RUN git clone --quiet --no-single-branch "$REPO" /src
# THE CONTEXT IS EITHER THE REPO ROOT OR site/ ITSELF, and this works with both. The catalog decides
# (`build.context`), and the catalog and this file live in different repositories, so they cannot change in
# one step: a Dockerfile that assumed either would break the next dev deploy in the window between them.
# `repo` is what `local` needs (it reads install.sh and the client from the tree); shared envs work either way.
COPY . /ctx
WORKDIR /src
RUN set -e; \
    if [ -f /ctx/site/build.mjs ]; then site=/ctx/site; root=/ctx; else site=/ctx; root=; fi; \
    rm -rf /src/site && cp -r "$site" /src/site; \
    for e in $(node -p "Object.keys(require('./site/envs.json').envs).join(' ')"); do \
      GOV_DEPS="$GOV_DEPS" node site/build.mjs "$e" --verify; \
    done; \
    if [ "$GOV_LOCAL" = 1 ]; then \
      [ -n "$root" ] || { echo "GOV_LOCAL=1 needs build.context: repo — the local site is built from the worktree's install.sh and client, which a site/-only context does not contain"; exit 1; }; \
      mkdir -p /tmp/pkg; \
      (cd "$root/publish/actions/ts" && npm ci --no-audit --no-fund --loglevel=error && npm pack --pack-destination /tmp/pkg --loglevel=error >/dev/null); \
      node site/build-local.mjs "$root" /tmp/pkg/svayam-opensource-gov-*.tgz --verify; \
    fi; \
    node site/caddyfile.mjs site/dist > /src/Caddyfile

FROM docker.io/library/caddy:2-alpine
COPY --from=build /src/site/dist /srv
COPY --from=build /src/Caddyfile /etc/caddy/Caddyfile
EXPOSE 4002
