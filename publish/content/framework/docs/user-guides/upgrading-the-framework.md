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

Your organization's repository was created by `gov setup`, which seeded it with the framework's content:
the `framework/` folder, the agent instruction files, and starting copies of your policies.

### The CLI carries its content

The `gov` command is installed from npm — `npm i -g @svayam-opensource/gov` (Node 24 or later). It is never
copied into a repository.

Each version of gov carries the framework content it was built with. The two always match. You never pick a
content version separately, and gov never downloads content behind your back:

- `gov setup` seeds a new repository from the content gov carries.
- `gov upgrade` brings an existing repository to the content gov carries.

So **upgrading the framework means installing a newer gov**:

```bash
npm i -g @svayam-opensource/gov@latest
gov upgrade            # shows what would change; writes nothing
gov upgrade --pr       # puts the change in a pull request for review
gov upgrade --apply    # or writes it into your working tree
```

### What an upgrade changes

The content's `MANIFEST.yaml` says how each file lands:

- **Framework files** (`framework/`, the agent instruction files, CI workflows) are replaced with the new
  version. Do not edit them; your edits would be lost.
- **Your files** (`org-config.yaml`, `policies/`) are created if missing and otherwise left exactly as you wrote
  them. A new file the release adds is added once, and is yours from then on.
- **`projects/` and your own knowledge** are never touched.
- **Leftovers of the template copy** — the framework's own `publish/` and `site/` folders, or the framework's
  README in place of yours — are removed or replaced, but only when gov recognises them as the framework's
  exact files. Anything you wrote stays.

After upgrading, run `gov validate` to confirm everything still validates.

### Using other content on purpose

Both commands accept two overrides, for when you deliberately want content other than the content gov carries:

- `--ref <commit|tag|branch>` — fetch the content at that point of the framework's repository.
- `--from <dir>` — use the content in a local directory.

For example, `gov upgrade --from ~/src/governed-agentic-dev-framework/publish/content`, or
`gov setup acme/acme-gov --ref v1.2.3`.

gov checks whatever you name against the content it was built with. If they differ, it refuses and writes
nothing — even when the version numbers agree, because a version number is a label and the check compares the
files themselves. To use newer content, install the gov that was built with it.

### What the test-merge gate catches

CI runs the same validators against `template/main` merges. A regression on
the upstream side (e.g. a framework file accidentally introducing a
double-curly placeholder token) fails the gate before it lands.

---
