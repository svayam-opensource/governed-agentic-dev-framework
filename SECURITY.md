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

## Supported Versions

The latest commit on the `publish` branch is the only actively supported version. Older snapshots may be patched at maintainer discretion if the impact warrants it.

## Public Discussion

Once a fix is released, the original reporter is credited (unless they prefer to remain anonymous) and the advisory is published with technical details.
