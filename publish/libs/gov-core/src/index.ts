// SPDX-License-Identifier: MIT
/**
 * `@svayam-opensource/gov-core` — WHERE a gov command is acting, and on whose behalf.
 *
 * `gov` (gov-work), `gov-cicd` and `gov-infra` are three independent CLIs (ADR: three clients). They share
 * no runtime and neither hosts the others. What every one of them must nonetheless agree about is the
 * ORG and the CONTEXT: which governance repo, which `agent_work_root`, and whether this invocation is
 * acting on a PROJECT branch or on `main`. Disagree about that and two tools quietly read and write
 * different repositories while reporting the same thing.
 *
 * That is the whole of this package, and the reason it is this small is a ruling, not an accident:
 *
 *   · **Identity and secrets are NOT here.** gov-work needs no IdP at all — its own requirements are git
 *     config and `gh auth`, both the user's own tools. Sessions, OIDC, the credential store and the Vault
 *     client belong to the deploy path, so they live in a PROPRIETARY library shared by gov-cicd and
 *     gov-infra (Policy Owner, 2026-08-06). Nothing of our identity model is published.
 *   · **Two rules decide membership:** in only if TWO OR MORE CLIENTS MUST AGREE about it, and this package
 *     holds MECHANISM while our GRAMMAR — path taxonomies, role names, `GOV_*` conventions — stays in the
 *     clients. Every export is a reason three packages might have to release together.
 */

export { parseOrgConfig, type OrgConfig } from "./location/org-config.js";
export { expandTilde, readTopLevelScalar } from "./location/yaml.js";
export {
  detectContext, contextFingerprint, renderBanner, isAcked, recordAck, hashText,
  type ContextMode, type ContextInfo, type ContextFacts, type Ack,
} from "./location/context.js";
