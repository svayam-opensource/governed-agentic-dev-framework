# SPDX-License-Identifier: MIT
# Clean-slate adopter environment for the gov adopter-journey e2e. Reproducible
# by ANY maintainer (no dependency on a personal image):
#   docker build -t gov-adopter-e2e publish/actions/ts/e2e
# node 24 + git + gh is all the journey needs; it installs the packed gov itself.
FROM node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# A clean non-root home, like a real adopter machine.
RUN useradd -m adopter
USER adopter
WORKDIR /home/adopter
CMD ["bash"]
