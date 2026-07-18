import type { Validator } from "./validate.js";
/** Extract non-generic {key, value} pairs from main's org-config.yaml text. */
export declare function privateValuesFromOrgConfig(mainConfigText: string): Array<{
    key: string;
    value: string;
}>;
/** Build a privacy Validator that scans for leaks of main's org-config values. */
export declare function makePrivacyValidator(mainConfigText: string): Validator;
