export type UpgradePlan = {
    readonly kind: "up-to-date";
    readonly version: string;
} | {
    readonly kind: "install";
    readonly version: string;
    readonly command: string;
} | {
    readonly kind: "error";
    readonly message: string;
};
export declare function upgradePlan(current: string, target: string | null): UpgradePlan;
export declare function formatUpgradePlan(p: UpgradePlan): string[];
