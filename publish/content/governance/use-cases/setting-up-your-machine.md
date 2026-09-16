---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Setting up your machine

What has to be true before your first session. Once per machine.

`install.sh` handles Node and the `gov` client; this is what it hands back to you — the
parts only a person can do, like signing in.

## 1. Before the first session

### Verify your env

```bash
git config --global user.name    # must be set
git config --global user.email   # must be set
gh api user --jq .login          # should print your GitHub handle
```

The framework reads `agent_work_root` from `org-config.yaml` (set when the
Policy Owner ran `gov setup`). The default is `~/.<org_slug_lower>/projects`
(e.g. `~/.acme/projects/`). To inspect:

```bash
yq '.agent_work_root' org-config.yaml
```

To override for a single command (e.g. in a CI sandbox), export `AGENT_WORK_ROOT`
in the shell — env wins over the org-config value.

### Confirm you have access to the GitHub Project

Authorization is **write access to the project's linked GitHub Project**
(`projectV2.viewerCanUpdate`). The Policy Owner (or any repo collaborator with
manage rights) creates the GitHub Project and grants you that access via
`gov manage assign`; org owners/admins already have access to everything.
If you lack write access, `gov seed`/`gov join` won't let you seed or join the
project — ask an owner to run `gov manage assign`. There is no per-project state
file; GitHub Project write access is the sole gate.

---
