// Local Ollama embeddings (rag-stack-decision §3). nomic-embed-text, 768-dim.
// No external API; no data leaves the host. Calls the local /api/embeddings.

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  health(): Promise<"ok" | "loading" | "down">;
}

export class OllamaEmbedder implements Embedder {
  constructor(
    public readonly model: string,
    public readonly dim: number,
    private readonly baseUrl: string,
  ) {}

  // Use the /api/embed endpoint (plural). The legacy /api/embeddings ignores
  // num_ctx and hard-caps at the default 2048-token context, which overflows on
  // the largest policy sections (~4.9k tokens). /api/embed with truncate:true
  // truncates to the model's native window instead of erroring, and supports
  // batch input arrays in one call.
  // Empirically the served nomic-embed-text context on this Ollama build caps
  // around ~2048 tokens (truncate:true does not save oversized inputs in batch
  // mode), so we char-truncate as a hard safety net. ~3.5 chars/token => 7000
  // chars stays comfortably under the window. Only the 4 longest sections in the
  // corpus exceed this; their lead content (the part embeddings weight most) is
  // preserved. Recorded as a v1 limitation in the report.
  private readonly maxChars = 7000;

  private cap(t: string): string {
    return t.length > this.maxChars ? t.slice(0, this.maxChars) : t;
  }

  private async embedReq(input: string | string[]): Promise<number[][]> {
    const capped = Array.isArray(input) ? input.map((t) => this.cap(t)) : this.cap(input);
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: capped, truncate: true }),
    });
    if (!res.ok) {
      throw new Error(`ollama embed ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { embeddings?: number[][] };
    if (!json.embeddings || json.embeddings.length === 0) {
      throw new Error("ollama returned empty embeddings");
    }
    return json.embeddings;
  }

  async embed(text: string): Promise<number[]> {
    return (await this.embedReq(text))[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embedReq(texts);
  }

  async health(): Promise<"ok" | "loading" | "down"> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return "down";
      const json = (await res.json()) as { models?: { name?: string }[] };
      const has = (json.models ?? []).some((m) => (m.name ?? "").startsWith(this.model));
      return has ? "ok" : "loading";
    } catch {
      return "down";
    }
  }
}
