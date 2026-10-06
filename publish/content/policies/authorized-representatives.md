# Authorized representatives — who approves what

**Document:** Authorized Representatives
**Governed by:** `policies/org-policy.md` section 5
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. As seeded, every approval falls to the Policy Owner,
> because on the first day of an adoption that is the only role anybody holds. Appointing owners, splitting a
> domain, adding a role or deleting a rule you do not want is the expected first act.
>
> This file names **real people**, and approvals are checked against it. Keeping it true is therefore not
> documentation work: a stale row here is an approval nobody actually gave.

---

## 1. Who approves an exception

### 1.1 Every exception has a named approver

An exception is approved only by the role named for its domain in section 1.2, and only by the person who
holds that role in section 4. While a role has nobody in it, the Policy Owner approves in its place. There is
no exception to this: an exception approved by anyone else is not approved.

### 1.2 Which role approves which kind of exception (starter)

| Kind of exception | Approved by |
|---|---|
| Legal | Legal Owner |
| Infrastructure | Infrastructure Owner |
| Architecture | System Architecture Owner, or Data Architecture Owner, whichever the exception concerns |
| Anything else | Policy Owner |

Who holds each role is written once, in section 4, and nowhere else.

The Policy Owner appoints or changes a representative by a pull request to this file, always, unless an
exception is approved. An
appointment announced anywhere else does not reach the approval check, because the check reads this file.

### 1.3 Nobody approves their own exception

The person who asks for an exception never approves it, in any domain. That holds for the Policy Owner too.
There is no exception to this.

gov's own checks cannot see who wrote a change and who approved it. The version-control platform can: set it
to require a review by somebody other than the author. `framework/docs/specs/framework-specification.md`
section 11.2 says what follows when a platform will not do that.

## 2. Keeping this file true

### 2.1 An agent does not appoint anybody

An agent never adds, removes or changes a representative in this file. An appointment is a decision a person
makes, and it is recorded by the person who made it. There is no exception to this.

### 2.2 A departure is recorded when access changes

When a named holder's access changes, this file is updated in the same pull request, so that the list and the
access cannot disagree. Updating it separately needs an approved exception.

## 3. Every role has a holder

Every role this organization defines, in section 4 or anywhere else in `policies/`, has a named person
holding it at all times. When a role falls vacant, the Policy Owner holds it until someone new is named, and
the vacancy is recorded here in the same pull request that removes the departing holder. A role with nobody in
it is a question nobody is answering, and an approval nobody can give.

The framework holds its own two roles, the Policy Owner and the Check Owner, to the same standard: `gov setup`
will not finish without both, and `gov doctor` reports either one when it falls empty.

## 4. The role list

The roles this organization defines, who holds each one, and which folders of `knowledge/` each one owns. This
is the list gov reads. It routes a change to a `knowledge/` folder to that folder's owner (gov writes
`CODEOWNERS` from it), and it names the person behind a role when a policy says, in plain English, that a role
owns one of its sections.

| Role | GitHub handle | Owns |
|---|---|---|
| Legal Owner | <LEGAL_OWNER_GITHUB> | `knowledge/legal/` |
| Infrastructure Owner | <INFRA_OWNER_GITHUB> | `knowledge/infrastructure/` |
| System Architecture Owner | <SYSTEM_ARCH_OWNER_GITHUB> | `knowledge/architecture/system/` |
| Data Architecture Owner | <DATA_ARCH_OWNER_GITHUB> | `knowledge/architecture/data/` |

How to read and change it:

- **Role** is a name you choose. Add a row for a new role, delete a row for a role you retire, rename freely,
  but keep the name the same as the one your policies use when they say who owns a section.
- **GitHub handle** is the person (or `org/team`) who holds the role. Leave it empty, or write `vacant`, when
  nobody does: the Policy Owner then approves in that role's place (section 3).
- **Owns** lists the `knowledge/` folders the role approves, separated by commas, or `—` for none. A folder
  nobody owns, and `knowledge/` as a whole, belong to the Policy Owner.
- The Policy Owner and the Check Owner are not listed here. They are the framework's own two roles, and
  `gov setup` records who holds them.

After a change here merges, run `gov upgrade` to regenerate `CODEOWNERS`. `gov doctor` reports a `CODEOWNERS`
that no longer matches this list.
