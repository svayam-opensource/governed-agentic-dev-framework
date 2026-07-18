/** The credentials file for an identity under the agent work root. */
export declare function credentialsPath(agentWorkRoot: string, identity: string): string;
/** A credential key is a stable id for one secret, e.g. `npm_token:npm.svayamtech.com`.
 *  Keep it to `[A-Za-z0-9_.:@/-]` so it survives as a `KEY=VALUE` line. */
export declare function credKey(kind: string, scope: string): string;
/** Parse `KEY=VALUE` lines (blank + `#` comments ignored). First `=` splits; value verbatim. */
export declare function parseCredentials(text: string): Map<string, string>;
/** Read one credential value, or undefined. Does not throw if the file is absent. */
export declare function getCredential(file: string, key: string): string | undefined;
/** Which credential keys does this identity already hold? (keys only — never values). */
export declare function listCredentialKeys(file: string): string[];
/**
 * Set/merge `key=value`, LINE-PRESERVING: replace the one line whose key matches, else
 * append. Everything else in the file is written back byte-for-byte, so a pre-existing
 * store in another shape is never clobbered. Creates dirs `0700` + file `0600`.
 */
export declare function setCredential(file: string, key: string, value: string): void;
/** Identities that already have a preferences dir under the work root (dir names). */
export declare function listIdentities(agentWorkRoot: string): string[];
/** True if an identity has a credentials file at all (used to decide create-vs-reuse). */
export declare function identityExists(agentWorkRoot: string, identity: string): boolean;
/** The default identity for the prompt — the logged-in user id. Overridable by the user. */
export declare function defaultIdentity(env?: NodeJS.ProcessEnv): string;
