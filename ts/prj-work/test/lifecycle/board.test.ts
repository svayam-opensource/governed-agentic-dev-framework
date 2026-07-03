// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import {
  validateBoard,
  boardValidationMessage,
  BoardFetchError,
  type BoardProject,
  type BoardValidation,
} from "../../src/lifecycle/board.js";
import {
  buildProjectQuery,
  parseProjectResponse,
  createGhBoard,
} from "../../src/lifecycle/gh-board.js";
import type { BoardRef } from "../../src/lifecycle/identity.js";

const ORG_REF: BoardRef = { owner: "Svayamtech", ownerField: "organization", number: 43 };

const project = (over: Partial<BoardProject> = {}): BoardProject => ({
  id: "PVT_x",
  title: "@Governance Common Project",
  shortDescription: "the prj CLI",
  linkedItemCount: 3,
  repoUrls: [],
  ...over,
});

/** A minimal gh GraphQL projectV2 response for an org board. */
function ghResponse(over: {
  title?: string | null;
  desc?: string | null;
  nodes?: Array<{ content: unknown | null }>;
} = {}): string {
  return JSON.stringify({
    data: {
      organization: {
        projectV2: {
          id: "PVT_x",
          title: over.title === undefined ? "@Governance Common Project" : over.title,
          shortDescription: over.desc === undefined ? "the prj CLI" : over.desc,
          items: { nodes: over.nodes ?? [{ content: { url: "u" } }, { content: null }] },
        },
      },
    },
  });
}

describe("prj-work Phase 2 — board validation (C01 gates)", () => {
  it("passes a well-formed board, warning only about a missing description", () => {
    expect(validateBoard(project())).to.deep.equal({ ok: true, warnings: [] });
    const noDesc = validateBoard(project({ shortDescription: null })) as Extract<
      BoardValidation,
      { ok: true }
    >;
    expect(noDesc.ok).to.equal(true);
    expect(noDesc.warnings).to.have.lengthOf(1);
  });

  it("fails (rc=1) a board with no title", () => {
    const v = validateBoard(project({ title: "   " }));
    expect(v).to.deep.equal({ ok: false, code: 1, reason: "no-title" });
    expect(boardValidationMessage(v as Extract<BoardValidation, { ok: false }>)).to.match(/no name/);
  });

  it("fails (rc=1) a board with no linked items", () => {
    const v = validateBoard(project({ linkedItemCount: 0 }));
    expect(v).to.deep.equal({ ok: false, code: 1, reason: "no-linked-items" });
    expect(boardValidationMessage(v as Extract<BoardValidation, { ok: false }>)).to.match(
      /Issues or PRs/,
    );
  });
});

describe("prj-work Phase 2 — gh board adapter", () => {
  it("builds a GraphQL query keyed on owner field + number", () => {
    const q = buildProjectQuery(ORG_REF);
    expect(q).to.include('organization(login: "Svayamtech")');
    expect(q).to.include("projectV2(number: 43)");
    const userQ = buildProjectQuery({ owner: "me", ownerField: "user", number: 5 });
    expect(userQ).to.include('user(login: "me")');
  });

  it("parses a response: title, description, and links counted only when content != null", () => {
    expect(parseProjectResponse(ghResponse())).to.deep.equal({
      id: "PVT_x",
      title: "@Governance Common Project",
      shortDescription: "the prj CLI",
      linkedItemCount: 1, // one content, one null
      repoUrls: [],
    });
  });

  it("extracts distinct repo URLs from linked items", () => {
    const resp = ghResponse({
      nodes: [
        { content: { repository: { url: "https://github.com/O/a" } } },
        { content: { repository: { url: "https://github.com/O/a" } } }, // dup
        { content: { repository: { url: "https://github.com/O/b" } } },
        { content: null },
      ],
    });
    expect(parseProjectResponse(resp).repoUrls).to.deep.equal([
      "https://github.com/O/a",
      "https://github.com/O/b",
    ]);
  });

  it("normalizes null title/description", () => {
    const p = parseProjectResponse(ghResponse({ title: null, desc: null, nodes: [] }));
    expect(p.title).to.equal("");
    expect(p.shortDescription).to.equal(null);
    expect(p.linkedItemCount).to.equal(0);
  });

  it("throws BoardFetchError on a missing project or non-JSON output", () => {
    const missing = JSON.stringify({ data: { organization: { projectV2: null } } });
    expect(() => parseProjectResponse(missing)).to.throw(BoardFetchError);
    expect(() => parseProjectResponse("not json")).to.throw(BoardFetchError, /non-JSON/);
  });

  it("createGhBoard.fetchProject runs gh and parses the result (injected runner)", () => {
    const calls: string[][] = [];
    const board = createGhBoard((args) => {
      calls.push(args);
      return ghResponse();
    });
    const p = board.fetchProject(ORG_REF);
    expect(p.title).to.equal("@Governance Common Project");
    expect(calls[0].slice(0, 3)).to.deep.equal(["api", "graphql", "-f"]);
    expect(calls[0][3]).to.include("projectV2(number: 43)");
  });

  it("wraps a gh failure in BoardFetchError", () => {
    const board = createGhBoard(() => {
      throw new Error("gh: not found");
    });
    expect(() => board.fetchProject(ORG_REF)).to.throw(BoardFetchError, /gh failed/);
  });
});
