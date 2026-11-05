/** Thin client for the Anthropic Messages API with a tool-use loop. */
import { config } from "../config.ts";

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: any) => Promise<unknown>;
}

export const llmEnabled = () => !!config.anthropicApiKey;

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

async function call(body: Record<string, unknown>) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `LLM HTTP ${res.status}`);
  return data;
}

/**
 * Runs a conversation with tools until the model answers in text (max `maxRounds` tool rounds).
 * Returns the final text and the list of tools used (shown to the user for transparency).
 */
export async function runWithTools(opts: { system: string; messages: Msg[]; tools: Tool[]; maxRounds?: number; maxTokens?: number }) {
  const messages: Msg[] = [...opts.messages];
  const used: { name: string; input: unknown }[] = [];
  const toolDefs = opts.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  for (let round = 0; round <= (opts.maxRounds ?? 5); round++) {
    const data = await call({
      model: config.anthropicModel,
      max_tokens: opts.maxTokens ?? 900,
      system: opts.system,
      messages,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
    });
    const blocks: Block[] = data.content ?? [];
    if (data.stop_reason !== "tool_use") {
      return { text: blocks.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim(), toolsUsed: used };
    }
    messages.push({ role: "assistant", content: blocks });
    const results: Block[] = [];
    for (const b of blocks) {
      if (b.type !== "tool_use") continue;
      const tool = opts.tools.find((t) => t.name === b.name);
      used.push({ name: b.name, input: b.input });
      try {
        const out = tool ? await tool.run(b.input ?? {}) : { error: "unknown tool" };
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out).slice(0, 12000) });
      } catch (e: any) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: String(e.message), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "I could not finish this analysis. Try a more specific question.", toolsUsed: used };
}
