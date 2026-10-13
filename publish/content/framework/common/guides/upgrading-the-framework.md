---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Upgrading the framework

Pulling new framework content into your organization, and what the test-merge gate exists to
catch.

## 10. Framework upgrades

Your organization's repository was created by the first-run flow's adopt step, which seeded it with the framework's
content:
the `framework/` folder, the agent instruction files, and starting copies of your policies.

### The CLI carries its content

The `gov` command is installed by install.sh, then the first-run flow (adopt / join / not sure); on Windows,
the installer. It is never copied into a repository.

Each version of gov carries the framework content it was built with. The two always match. You never pick a
content version separately, and gov never downloads content behind your back:

- Adopting (the first-run flow) seeds a new repository from the content gov carries.
- `gov upgrade` brings an existing repository to the content gov carries.

So **upgrading the framework means installing a newer gov** — run install.sh again (on Windows, the installer:
`winget upgrade Svayam.Gov`), then:

```bash
gov upgrade            # shows what would change; writes nothing
gov upgrade --pr       # puts the change in a pull request for review
gov upgrade --apply    # or writes it into your working tree
```

On Windows, gov is installed by its MSI, so the first step is `winget upgrade Svayam.Gov` instead; the
`gov upgrade` steps are the same. gov's own "newer version" notice prints the right command for your machine.

### What an upgrade changes

The content's `MANIFEST.yaml` says how each file lands:

- **Framework files** (`framework/`, the agent instruction files, CI workflows) are replaced with the new
  version. Do not edit them; your edits would be lost.
- **Your files** (`org-config.yaml`, `policies/`) are created if missing and otherwise left exactly as you wrote
  them. A new file the release adds is added once, and is yours from then on.
- **Your organization's details are filled in** every file the upgrade creates: your organization's name, the
  Policy Owner, and the other values in `org-config.yaml` and `policies/governance.yaml` replace placeholders
  such as `<ORG_NAME>`, as a first-time adoption does. Files that were already there are not changed, even if they still
  contain a placeholder.
- **`projects/` and your own knowledge** are never touched.
- **Leftovers of the template copy** — the framework's own `publish/` and `site/` folders, or the framework's
  README in place of yours — are removed or replaced, but only when gov recognises them as the framework's
  exact files. Anything you wrote stays.
- **The installed check workflows are refreshed.** gov installs two workflows in your governance repo's
  `.github/workflows/`: `approver-check.yml` (by `gov repo protect apply`) and `gov-checks.yml` (by
  `gov check install`). When the framework's approver-check template changed, the upgrade replaces the
  installed copy with the new template. When what `gov check install` would write changed, the upgrade
  re-renders `gov-checks.yml` and pins it to the gov that wrote it (`npm install -g @svayam-opensource/gov@<version>`),
  so the upgrade pull request's own checks run the gov that brings the new layout. `--gov-package <spec>` installs
  something else instead. A copy that did not change is left alone. A copy someone edited by hand is never
  overwritten: the upgrade lists it as a conflict, and you reconcile it yourself. (`gov-checks.yml` ends with a
  digest line; gov uses it to tell an edited copy from its own.) Later runs of `gov check install` keep the pin
  unless you pass `--gov-package`.

After upgrading, run `gov validate` to confirm everything still validates.

### Reading the upgrade pull request

`gov upgrade --pr` puts each kind of change in its own commit, always in this order. A commit with nothing in it
is left out.

1. **framework**: the framework's files arrive, and the framework files this release retires are removed.
2. **org moves**: your own files move to their new paths, byte for byte. Nothing in them changes.
3. **migrations**: values that move between files are carried across. Starter files you lacked are added, and
   the record of the moves is written.
4. **PROPOSED prose**: text gov suggests for your documents, such as an old path rewritten to the new one. Keep
   it, edit it on the branch, or drop the commit before you merge.

The PR description lists every move, retirement, migration and substitution. It also lists every file gov did
not recognise; those files are left exactly where they are. It ends with what to run after you merge:
`gov rules propose --all`, then `gov rules build`, `gov repo protect apply` and `gov check install --all`.

### Using other content on purpose

Setup and `gov upgrade` accept two overrides, for when you deliberately want content other than the content gov carries:

- `--ref <commit|tag|branch>` — fetch the content at that point of the framework's repository.
- `--from <dir>` — use the content in a local directory.

For example, `gov upgrade --from ~/src/governed-agentic-dev-framework/publish/content`, or `--ref v1.2.3` on the
setup verb (see the command reference).

gov checks whatever you name against the content it was built with. If they differ, it refuses and writes
nothing — even when the version numbers agree, because a version number is a label and the check compares the
files themselves. To use newer content, install the gov that was built with it.

### What the test-merge gate catches

CI runs the same validators against `template/main` merges. A regression on
the upstream side (e.g. a framework file accidentally introducing a
double-curly placeholder token) fails the gate before it lands.

---
