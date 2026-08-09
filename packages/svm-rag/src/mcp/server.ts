import type { RagEngine } from "../engine.js";
import { TOOLS } from "./tools.js";

// Minimal MCP server over stdio (JSON-RPC 2.0, line-delimited). Dependency-free —
// implements the subset of MCP the contract needs: initialize, tools/list,
// tools/call. The HTTP transport sits behind the same Authentik edge in prod;
// stdio is the local/agent transport. Each tool dispatches to the engine.

const SERVER_INFO = { name: "svayam-knowledge", title: "Svayam Org Knowledge (RAG)", version: "0.1.0" };

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function handleMessage(msg: JsonRpcMessage, engine: RagEngine): Promise<JsonRpcMessage | null> {
  const reply = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string): JsonRpcMessage =>
    ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
      return null; // notification, no response
    case "tools/list":
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `unknown tool ${name}`);
      try {
        const out = await tool.call(msg.params?.arguments ?? {}, engine);
        return reply({
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
          isError: false,
        });
      } catch (e: any) {
        return reply({
          content: [{ type: "text", text: `error: ${String(e?.message ?? e)}` }],
          isError: true,
        });
      }
    }
    default:
      if (msg.id === undefined) return null; // unknown notification
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

/** Run the stdio loop. */
export function runStdioServer(engine: RagEngine): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcMessage;
      try { msg = JSON.parse(line); } catch { continue; }
      const out = await handleMessage(msg, engine);
      if (out) process.stdout.write(JSON.stringify(out) + "\n");
    }
  });
}
