# Security Policy

## Reporting a Vulnerability

If you believe you've found a security issue in this framework, **please do not open a public GitHub issue.** Public issues are visible to everyone immediately and would expose the problem before a fix is available.

Instead:

1. Open a **private security advisory** via GitHub:
   `Security` tab → `Report a vulnerability` button.
2. Provide as much detail as you can:
   - Affected component (script, validator, workflow, etc.)
   - Reproduction steps or proof-of-concept
   - Impact assessment
   - Any suggested mitigation

A maintainer will respond within a few business days. Once the issue is confirmed and a fix is in progress, we'll coordinate disclosure timing with you.

## Scope

This framework is shell scripts, Python validators, GitHub Actions workflows, and configuration. In-scope concerns include:

- Command injection or shell metacharacter mishandling in scripts
- Path traversal in validators or config readers
- Secrets handling (the framework should never write or log credentials)
- Privacy boundary violations (private values leaking into the publish branch)
- CI workflow privilege escalation (e.g., a PR triggering write-access actions)
- Authentication or authorization gaps in the test-merge / privacy gates

Out of scope:

- Vulnerabilities in upstream dependencies (`gh`, `git`, `yq`, `python3`, `pyyaml`) — report those to their respective maintainers.
- Adopters' own customized policies after they fork the template.
- Issues that require physical access to a developer's machine.

## What gov verifies before it runs downloaded code

`gov` downloads and runs code in a few places. This is what it checks, and what it does not check yet.

| What is downloaded | What gov checks | What it does not check |
| --- | --- | --- |
| Node.js tarball (`install.sh`) | The SHA-256 against the `SHASUMS256.txt` that nodejs.org publishes beside the release. | The `.asc` signature on `SHASUMS256.txt`. Both come from the same server, so a compromised nodejs.org could change both. *Deferred.* |
| `install.sh` itself | Nothing. You fetch it yourself, and `curl … \| bash` runs whatever is served. | A digest published with each release that you can check first. *Deferred (#235).* |
| An agent's npm or pip package | That the package name is the one the vendor publishes (the agent catalog lists only vendor-owned names). npm and pip check their own downloads. | Package signatures or provenance. |
| A vendor's install script (Cursor, IBM Bob) | gov downloads the script **once** and checks it. If gov has a **pinned** SHA-256 for the script (IBM Bob), a script with a different digest is refused. The message names the URL, the digest gov expected and the digest it got. If there is **no pin** (Cursor puts its release number in the script, so the digest changes with every release), gov shows the URL and the digest and asks you. The script runs only if you answer `y`. Without a terminal it does not run. Either way, bash runs the exact bytes that were checked, from memory. Nothing is downloaded a second time. | Whether the vendor's script is safe. A pin records the script that was reviewed, and that review is all a pin proves. Windows: gov does not run vendor shell scripts there. It points you to the vendor's page. |

Pins live in `publish/actions/ts/src/cli/agent-catalog.ts` (`scriptSha256`). Each week the `catalog-freshness` workflow downloads every vendor script. When a pinned script has changed, the workflow opens a pull request with the new digest. Read the new script before you merge that pull request. Until a gov release carries the new pin, gov refuses the changed script.

## Supported Versions

The latest commit on the `publish` branch is the only actively supported version. Older snapshots may be patched at maintainer discretion if the impact warrants it.

## Public Discussion

Once a fix is released, the original reporter is credited (unless they prefer to remain anonymous) and the advisory is published with technical details.
