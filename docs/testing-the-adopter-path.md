# Testing the adopter path

**Audience:** internal testers and contributors. Adopters do not need this page —
theirs is one command, and this is how we make sure it stays that way.

Everything an adopter hits before `gov` exists is invisible from a developer's
machine, where Node, git, `gh` and a signed-in token are all long since true.
Every defect this path has produced was found by running it somewhere those things
were **not** true. So: throwaway containers, one per scenario.

---

## First decide which question you are asking

There are four routes on this page and they answer different questions. Picking the
wrong one wastes a walk — or worse, passes while testing the wrong binary.

| Your change is… | Walk | Because |
|---|---|---|
| **already released** | the **live site** — `curl -fsSL https://gov.svayamtech.com/install.sh -o install.sh && bash install.sh` | It is the artefact an adopter receives, and it exercises the site and the fetch-then-run form too. No mount, no `GOV_PKG`. |
| **deployed to dev** | **`gov-dev.svayamtech.com`** — see *Walk what dev has deployed* below | The dev-first loop. Installer from the `dev` ref, client from the dev registry at `@dev`. Not for template changes. |
| **only in your working tree** | the **local site** — see *Walk your working tree* below | Your installer and your client, served on your machine. Nothing pushed, nothing deployed. Start here. |
| **no gov-cicd to hand** | the **tarball recipe** below (`GOV_PKG`) | The same test by hand: mount a packed client and your `install.sh` into the container yourself. |

Check before assuming: `npm view @svayam-opensource/gov version` against the commit
you are testing. If your fix is in that version, use the site.

### Walk your working tree — before anything goes anywhere

The loop to use first: fix it locally, then send it to dev. **Commit** your change (the deploy judges drift
on `HEAD`, so an uncommitted edit reads as `no-op` — pushing is not needed), then from the **project
directory** (for `local`, the catalog is your working tree):

```bash
gov-cicd deploy gov-install --env local
```

gov-work deploys first, then the site, which comes up on `127.0.0.1:4002` carrying a fourth build,
`local`, made from your worktree: its `install.sh`, and a client packed from its `publish/actions/ts` and
served at `/gov.tgz`. Walk it from a container:

```bash
docker run --rm -it rockylinux:9 bash
# root prep as in the base recipe, then as tester:
curl -fsSL http://host.docker.internal:4002/install.sh -o install.sh && bash install.sh
```

**The tell that you are walking your own build**, since the client's version string is the same as the
release it will become: the installer prints
`Installing the governance client — http://host.docker.internal:4002/gov.tgz`. Anything else, and it is not.

A client-only change counts: gov-install's catalog entry lists `publish/actions/ts` under `also_local`, so
locally — and only locally — the site rebuilds when the client does.

It never leaves your machine. Only a local build is given `GOV_LOCAL=1`, a local image is never pushed,
and the `local` build answers only to `localhost`, `127.0.0.1` and `host.docker.internal`. Every other host,
as ever, gets a 404.

`host.docker.internal` reaches the host out of the box on Docker Desktop. On native Linux docker, add
`--add-host=host.docker.internal:host-gateway` to the walker, and note the site is bound to loopback.
`install.ps1` gets the same treatment: the local site's Windows installer installs your client from
`/gov.tgz`, and every shared site pins its own env's package and registry, exactly as `install.sh` does.

### Walk what `dev` has deployed

Once a change is deployed to dev, walk **`gov-dev.svayamtech.com`** in a container —
the same fetch-then-run command, the dev host:

```bash
curl -fsSL https://gov-dev.svayamtech.com/install.sh -o install.sh && bash install.sh
```

That is the dev-first loop: change lands in `dev` → deploy → walk here → promote.
It installs `install.sh` from the `dev` ref and the client from the dev registry at
dist-tag `@dev` (`⟨semver⟩-dev.g⟨sha7⟩`). **Check the version it reports** — if it
says a clean release like `1.2.3`, the dev pin is wrong and you are walking the code
your change replaced.

Two things it does **not** give you, so do not rely on it for them:

- **Governance template content.** Founding an org (answer **A**) runs
  `gh repo create --template`, which always copies the framework's **`main`**. A dev
  walk exercises a dev *client* against *released* templates. A template change cannot
  be walked from here.
- **A developer machine.** A fresh container has no `~/.npmrc`. The installer had a
  bug that only bit where `@svayam-opensource:registry` was mapped — a scope mapping
  silently outranks `--registry` — and every container walk passed straight over it.
  Anything that depends on the tester's own npm config needs a test that plants that
  config first.

---

## The one thing testers do that adopters don't: `GOV_PKG`

`install.sh` installs the **published** package:

```bash
npm i -g @svayam-opensource/gov
```

Which is what you want it to do — and useless for testing an unreleased change,
because the published version does not contain it. `GOV_PKG` overrides **what** is
installed and nothing else:

```bash
export GOV_PKG=/tmp/gov.tgz                     # a local build
export GOV_PKG='@svayam-opensource/gov@next'    # a prerelease dist-tag
```

The Node download, the home-directory install, the PATH edit and the hand-off to
`gov doctor --fix` are identical either way. That is the point: you are testing the
route an adopter walks, carrying a different parcel.

> **Never hardcode it into `install.sh`.** A script that installs from
> `/tmp/gov.tgz` fails on every real machine, and would fail *late* — after the
> Node install has already succeeded.

Build the parcel first:

```bash
cd publish/actions/ts
npm run build && npm pack --pack-destination ~/scratch
# → ~/scratch/svayam-opensource-gov-<version>.tgz
```

Re-pack after **every** source change. A stale tarball is the most common way to
spend twenty minutes debugging a fix you already made.

---

## The base recipe

```bash
docker run --rm -it \
  -v ~/scratch/svayam-opensource-gov-1.2.2.tgz:/tmp/gov.tgz:ro \
  rockylinux:9 bash
```

Then, **as root**, make the container resemble a real machine — a user who is not
root, with `sudo` available:

```bash
dnf install -y sudo
useradd -m tester
echo 'tester ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/tester
su - tester
```

Do **not** `dnf install curl tar`. They are already there — `curl-minimal`
provides curl, and asking for the full `curl` package *conflicts* with it. That is
itself a finding worth remembering: our documentation must say "check that curl
works", never "install curl".

Then, as `tester`, the whole adopter step:

```bash
export GOV_PKG=/tmp/gov.tgz
curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh -o install.sh \
  && bash install.sh
```

Testing an unpushed `install.sh`? Mount it rather than fetching one:
`-v "$PWD/install.sh":/tmp/install.sh:ro`, then `bash /tmp/install.sh`. (Swapping the
branch name into the URL works too, but only after you push.) Or skip all of this and
use the local site above, which does both for you.

It will show you what is missing, ask once, and — if you say yes — install git,
install `gh`, and walk you through signing in to GitHub.

### Then, two more steps

```bash
source ~/.bashrc     # this shell predates the install; it has never heard of gov
gov list
```

`source` is not optional and not superstition: `install.sh` appended the PATH entry
to a file your **already-running** shell read minutes ago. Skip it and the next
thing you type is `gov: command not found`, which looks like a failed install and
is not one.

`gov list` is the shortest way to reach the **first-run role question** (A/B/C).
Answer **C** first — it only prints.

---

## Scenarios worth running

Each is one line different from the recipe above, and each has broken something
at least once.

| # | Scenario | How | What must happen |
|---|---|---|---|
| 1 | **Nothing installed** | `rockylinux:9` as above | Node downloaded to `~/.local/share/gov`, gov installed, `--fix` offers git + gh |
| 2 | **An old Node is present** | `dnf install -y nodejs` first (RHEL 9 ships 16) | Node 24 installed *alongside*; the system's Node untouched; no `dnf` conflict |
| 3 | **Run twice** | run the same command again | "already present", nothing re-downloaded, no duplicate PATH entry |
| 4 | **No sudo rights** | omit the `sudoers.d` line | One sentence explaining that installing git/gh needs an administrator, then clean skips — never raw `sudo:` errors |
| 5 | **No sudo at all** | omit `dnf install -y sudo` too | Same, phrased for a machine with no `sudo` |
| 6 | **No terminal** | `bash < install.sh` instead of `\| bash` | Reports, names `gov doctor --fix`, exits — must not hang |
| 7 | **Unattended** | `gov doctor --fix --yes` | Never reaches `gh auth login`; names it as the human's remaining job |
| 8 | **First run** | `gov list` | The A/B/C role question. **C** is the safe one to explore — it only prints |

### Other distributions

Swap the image and the root-side prep. Everything else is identical.

| Distribution | Image | Root prep |
|---|---|---|
| Rocky / RHEL | `rockylinux:9` | `dnf install -y sudo` |
| Fedora | `fedora:41` | `dnf install -y sudo` |
| Ubuntu | `ubuntu:24.04` | `apt-get update && apt-get install -y curl sudo ca-certificates` |
| Debian | `debian:12` | `apt-get update && apt-get install -y curl sudo ca-certificates` |

They differ in ways that matter and have each caught something: Fedora carries
`gh` in its own repositories while Rocky does not, and dnf5 renamed the command
that adds one.

### macOS, without disturbing your own machine

```bash
T=$(mktemp -d)
env -i HOME=$T SHELL=/bin/zsh PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  GOV_PKG=~/scratch/svayam-opensource-gov-1.2.2.tgz \
  bash ./install.sh
rm -rf $T
```

`env -i` and the stripped `PATH` are load-bearing: without them the script finds
the Node you already have, skips the install, and tests nothing. `HOME=$T` keeps
the PATH edit out of your real `~/.zshrc`.

### Windows

Not testable locally — Docker on a macOS or Linux host cannot run Windows
containers, and `pwsh` on Linux has none of the three things `install.ps1` is made
of (`LOCALAPPDATA`, `PROCESSOR_ARCHITECTURE`, a user-scoped `PATH`).

The `bootstrap` job in `.github/workflows/node-ci.yml` is the test bed: it runs on
`windows-latest` with `setup-node` deliberately absent and the runner's own Node
stripped from `PATH`. **Open a PR to run it.** A push to a branch will not — the
workflow's `push` trigger is limited to `main` and `dev`.

---

## What to look at, beyond pass or fail

The scenarios above tell you whether it worked. These questions tell you whether
it is any good, and they are the ones worth writing up:

- **Did anything ask you something you could not answer?** That was the original
  defect: a clone-URL prompt only a joiner could answer.
- **Did an error explain itself, or hand you the tool's own words?** `sudo: a
  password is required` and `No such command: config-manager` are both true and
  both useless to someone who did not go looking for them.
- **Did you have to leave the terminal to find out what to do next?**
- **Did anything need administrator rights that shouldn't have?** Installing gov
  needs none. Only installing git or `gh` does.

Record findings as you go. `#186`'s were logged one at a time while testing, and
seven of them turned out to be real.

---

## What a container cannot test, and must not be marked failed for

Some steps cannot pass in here no matter how correct gov is. Recognise them, or you
will file gov defects against the test rig — three walks were lost that way.

**Any browser-based sign-in.** The agent starts a loopback listener *inside* the
container and prints a URL for a browser that is *outside* it, so the callback never
arrives. IBM Bob is the one you will hit first: it listens on `127.0.0.1:<random>`
and waits. Nothing is wrong with Bob or with gov.

Two ways through, and pick deliberately:

```bash
# in the container — skip the browser entirely
export BOB_API_KEY=...        # then let gov's key route take it
```

or run that one step on the host, where a browser exists.

This is also why **#213** matters and why `98-desktop-hint.sh` asserts it: on a machine
with no desktop, gov must offer the paste-a-key route *first* and must never withhold the
browser route. If you see gov push you at a browser in here, that **is** a gov defect —
the distinction is between gov offering an impossible route first (a defect) and the
route itself being impossible in a container (the rig).

**Anything needing a real desktop.** `98-desktop-hint.sh` runs an actual `Xvfb` when the
image has one and says `SKIPPED` when it does not. A skipped assertion is not a pass;
if the image lacks `Xvfb`, that branch was not exercised here at all.

---

## Resetting

Containers are `--rm`, so scenario 1 is a fresh `docker run`. To reset in place
without leaving the container:

```bash
rm -rf ~/.local/share/gov ~/.npm-global ~/.config/gov ~/.gov
sed -i '/added by the gov installer/,+1d' ~/.bashrc
exec bash -l
```
