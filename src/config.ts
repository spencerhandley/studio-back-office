try {
  process.loadEnvFile();
} catch {
  // No .env file. Environment variables can still come from the shell.
}

type LlmProvider = "anthropic" | "claude-cli" | "mock";
type SmsMode = "twilio" | "simulator";

const smsMode = (process.env.SMS_MODE ?? "simulator") as SmsMode;
const port = Number(process.env.PORT ?? 8787);

export const config = {
  port,
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  dbPath: process.env.DB_PATH ?? "data/studio.db",
  smsMode,
  // The number creators text. Shown on the landing page and in help text.
  displayNumber: process.env.STUDIO_DISPLAY_NUMBER ?? process.env.TWILIO_FROM ?? "(555) 555-0100",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    from: process.env.TWILIO_FROM ?? "",
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
    // Only for local tunnels where the URL Twilio signs differs from PUBLIC_URL.
    skipSignature: process.env.TWILIO_SKIP_SIGNATURE === "1",
  },
  llm: {
    provider: (process.env.LLM_PROVIDER ?? "claude-cli") as LlmProvider,
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    cliModel: process.env.CLAUDE_CLI_MODEL ?? "sonnet",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 120_000),
  },
  // The phone simulator and dev endpoints. On by default in simulator mode only.
  devTools: process.env.DEV_TOOLS ? process.env.DEV_TOOLS === "1" : smsMode === "simulator",
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 30_000),
};
