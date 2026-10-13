---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Setting up your machine

What has to be true before your first session. Once per machine.

install.sh, then the first-run flow (adopt / join / not sure), handles Node, the `gov` client and your
organization; on Windows, the installer does the same. This is what it hands back to you — the parts only a
person can do, like signing in.

`install.sh` keeps its own Node out of your way: a Node you already have stays the one your
shell finds. Where `~/.local/bin` is on your `PATH` it changes no shell profile at all;
elsewhere it appends one line to the end of your profile and tells you which file.

## 1. Before the first session

### Verify your env

```bash
git config --global user.name    # must be set
git config --global user.email   # must be set
gh api user --jq .login          # should print your GitHub handle
```

Your project folders live in your **work root**. It is your own setting, not the
organization's, so it is not in `org-config.yaml`. The default is
`~/.gov/<slug>/projects`, where `<slug>` is your organization's `org_slug` in
lower case (e.g. `~/.gov/acme/projects/`), beside the governance repository in
`~/.gov/<slug>/gov_repo`. To keep your project folders somewhere else, add one
line to `~/.gov/work-roots`: your GitHub organization, a tab, and the path:

```bash
printf 'acme\t%s\n' "$HOME/src/acme" >> ~/.gov/work-roots
```

### On Windows: git and gh

The Windows installer brings Node and `gov`, not git or the GitHub CLI. The first time
you run `gov`, it checks for both and, once you agree, installs them for your account
only — no administrator needed:

```powershell
winget install --id Git.Git -e --scope user
winget install --id GitHub.cli -e --scope user
```

If you answer no, nothing is installed and these are the commands to run yourself. If a
package has no per-user installer, gov says so, prints the command to run in an
administrator terminal, and leaves that step unticked until it is done.

### Confirm you have access to the GitHub Project

Authorization is **write access to the project's linked GitHub Project**
(`projectV2.viewerCanUpdate`). The Policy Owner (or any repo collaborator with
manage rights) creates the GitHub Project and grants you that access via
`gov manage assign`; org owners/admins already have access to everything.
If you lack write access, `gov seed`/`gov join` won't let you seed or join the
project — ask an owner to run `gov manage assign`. There is no per-project state
file; GitHub Project write access is the sole gate.

---
