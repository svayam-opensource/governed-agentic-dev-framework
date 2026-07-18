import { homeForOrg, removeOrg, upsertHome } from "./registry.js";
/** Register (or update) a gov home for `org` at the absolute `homePath`. */
export function orgAdd(deps, org, homePath) {
    const cfg = deps.govConfigAt(homePath);
    if (cfg === null)
        return { ok: false, code: 1, message: `'${homePath}' is not a gov repo (no org-config.yaml, or a .bases clone).` };
    if (cfg.org !== org)
        return { ok: false, code: 1, message: `'${homePath}' belongs to org '${cfg.org}', not '${org}'.` };
    deps.store.writeHomes(upsertHome(deps.store.readHomes(), org, homePath));
    return { ok: true, lines: [`Registered ${org} → ${homePath}`] };
}
/** Select the active org (must already be registered). */
export function orgUse(deps, org) {
    if (homeForOrg(deps.store.readHomes(), org) === null) {
        return { ok: false, code: 1, message: `Org '${org}' is not registered — add it first: prj org add ${org} <home>.` };
    }
    deps.store.writeActiveOrg(org);
    return { ok: true, lines: [`Active org → ${org}`] };
}
/** List registered homes, marking the active one. */
export function orgList(deps) {
    const homes = deps.store.readHomes();
    const active = deps.store.readActiveOrg();
    if (homes.length === 0)
        return { ok: true, lines: ["No orgs registered. Add one: prj org add <org> <home>."] };
    const lines = homes.map((h) => `${h.org === active ? "* " : "  "}${h.org}\t${h.home}`);
    return { ok: true, lines: ["Registered gov homes (* = active):", ...lines] };
}
/** Remove an org's home; clears active-org if it was the one removed. */
export function orgRemove(deps, org) {
    const homes = deps.store.readHomes();
    if (homeForOrg(homes, org) === null)
        return { ok: false, code: 1, message: `Org '${org}' is not registered.` };
    deps.store.writeHomes(removeOrg(homes, org));
    if (deps.store.readActiveOrg() === org)
        deps.store.clearActiveOrg();
    return { ok: true, lines: [`Removed ${org}`] };
}
