import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { config } from "./config.ts";
import { logLlmCall } from "./db.ts";

export type LlmImage = { mediaType: string; base64: string };
export type LlmRequest = {
  purpose: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: LlmImage[];
  userId?: number;
};

type MockResponder = (req: LlmRequest) => unknown | Promise<unknown>;
let mockResponder: MockResponder | null = null;

// Tests swap in a deterministic responder.
export function setMockResponder(fn: MockResponder | null) {
  mockResponder = fn;
}

export function llmAvailable(): boolean {
  if (config.llm.provider === "anthropic") return Boolean(config.llm.apiKey);
  if (config.llm.provider === "mock") return Boolean(mockResponder);
  return true;
}

// One structured call. Every provider returns an object that matches `schema`.
export async function callStructured<T>(req: LlmRequest): Promise<T> {
  const started = Date.now();
  const provider = config.llm.provider;
  const model = provider === "anthropic" ? config.llm.model : provider === "claude-cli" ? config.llm.cliModel : "mock";
  try {
    let out: unknown;
    if (provider === "anthropic") out = await viaAnthropic(req);
    else if (provider === "claude-cli") out = await viaClaudeCli(req);
    else {
      if (!mockResponder) throw new Error("No mock responder set");
      out = await mockResponder(req);
    }
    logLlmCall(req.userId ?? null, req.purpose, provider, model, Date.now() - started, true);
    return out as T;
  } catch (err) {
    logLlmCall(req.userId ?? null, req.purpose, provider, model, Date.now() - started, false, String(err).slice(0, 500));
    throw err;
  }
}

// Production path: the Messages API with one forced tool whose input schema is the response shape.
async function viaAnthropic(req: LlmRequest): Promise<unknown> {
  const content: unknown[] = (req.images ?? []).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  content.push({ type: "text", text: req.prompt });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.llm.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: 8000,
      system: req.system,
      messages: [{ role: "user", content }],
      tools: [{ name: "respond", description: "Return the response.", input_schema: req.schema }],
      tool_choice: { type: "tool", name: "respond" },
    }),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  });
  const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[]; error?: { message: string } };
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${json.error?.message ?? "unknown error"}`);
  const block = json.content?.find((b) => b.type === "tool_use" && b.name === "respond");
  if (!block) throw new Error("Anthropic response had no respond tool call");
  return block.input;
}

// Local testing path: the Claude Code CLI on the developer's subscription, with no tools and no project settings.
function viaClaudeCli(req: LlmRequest): Promise<unknown> {
  const args = [
    "-p",
    "--system-prompt",
    req.system,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(req.schema),
    "--tools",
    "",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--model",
    config.llm.cliModel,
  ];
  const prompt = req.images?.length ? `${req.prompt}\n\n(The creator attached ${req.images.length} image(s), which this test provider cannot show you.)` : req.prompt;
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("claude CLI timed out"));
    }, config.llm.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(stdout) as { structured_output?: unknown; is_error?: boolean; result?: string };
        if (json.is_error || json.structured_output === undefined) {
          reject(new Error(`claude CLI returned no structured output: ${(json.result ?? stderr).slice(0, 300)}`));
          return;
        }
        resolve(json.structured_output);
      } catch {
        reject(new Error(`claude CLI exited ${code}: ${(stderr || stdout).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
