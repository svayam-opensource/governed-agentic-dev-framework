/**
 * `gov licence` finds the paid module the way `gov check` does (Policy Owner ruling 2026-10-24: "use the check
 * loader"). Before this, bin.ts called runLicence(argv) with no loader, so the module was always "absent": `install`
 * never said "gov-check is active" and `status` never reached the module — measured on the first real dev install.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { licenceModuleLoader } from "../../src/cli/licence-run.js";
import type { LoadDeps, LoadedModule } from "../../src/check-seam/loader.js";

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "src");

describe("gov licence — module loader", () => {
  it("an active module hands its licence API to the licence verb", async () => {
    const licence = { status: () => ({ state: "active" }) as never, login: async () => {} };
    let seen: LoadDeps | undefined;
    const load = async (d: LoadDeps): Promise<LoadedModule> => { seen = d; return { state: "active", via: "licence-install", module: { licence } as never }; };
    const m = await licenceModuleLoader({ govVersion: "2.0.0-test", env: { GOV_LICENCE_API: "http://x/api/v1" }, load })();
    expect(m.state).to.equal("active");
    if (m.state !== "active") return;
    expect(m.licence).to.equal(licence);
    expect(m.via).to.equal("licence-install");
    // The module reads its licence service from the SAME env gov was given (one variable, ruling Q4).
    expect(seen!.env.GOV_LICENCE_API).to.equal("http://x/api/v1");
  });

  it("absent and refused pass through unchanged", async () => {
    const absent = await licenceModuleLoader({ govVersion: "t", env: {}, load: async () => ({ state: "absent" }) })();
    expect(absent).to.deep.equal({ state: "absent" });
    const refused = await licenceModuleLoader({ govVersion: "t", env: {}, load: async () => ({ state: "refused", lines: ["no lease"] }) })();
    expect(refused).to.deep.equal({ state: "refused", lines: ["no lease"] });
  });

  it("looks again on every call: install loads the module it has just put on disk", async () => {
    let calls = 0;
    const loader = licenceModuleLoader({ govVersion: "t", env: {}, load: async () => { calls++; return { state: "absent" }; } });
    await loader(); await loader();
    expect(calls).to.equal(2);
  });

  it("bin.ts wires the loader into `gov licence` (a bare runLicence(argv) leaves the module absent forever)", () => {
    const bin = fs.readFileSync(path.join(SRC, "cli", "bin.ts"), "utf8");
    expect(bin).to.match(/runLicence\(argv,\s*licenceModuleLoader\(/);
  });
});
