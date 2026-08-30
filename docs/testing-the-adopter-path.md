# Testing the adopter path

**Audience:** internal testers and contributors. Adopters do not need this page —
theirs is one command, and this is how we make sure it stays that way.

Everything an adopter hits before `gov` exists is invisible from a developer's
machine, where Node, git, `gh` and a signed-in token are all long since true.
Every defect this path has produced was found by running it somewhere those things
were **not** true. So: throwaway containers, one per scenario.

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
curl -fsSL https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.sh | bash
```

Testing an unmerged branch? Swap `main` for the branch name in that URL.

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

## Resetting

Containers are `--rm`, so scenario 1 is a fresh `docker run`. To reset in place
without leaving the container:

```bash
rm -rf ~/.local/share/gov ~/.npm-global ~/.config/gov ~/.gov
sed -i '/added by the gov installer/,+1d' ~/.bashrc
exec bash -l
```
