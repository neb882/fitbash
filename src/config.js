/** Reads settings from environment variables (see .env.example). */
export function loadConfig(env = process.env) {
  const int = (value, fallback, min, max) => {
    const n = Number.parseInt(value ?? "", 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return {
    port: int(env.PORT, 3000, 1, 65535),
    provider: (env.FITBASH_PROVIDER || "mock").toLowerCase(),

    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.FITBASH_GEMINI_MODEL || "gemini-nano-banana-2.1",
    geminiImageSize: env.FITBASH_GEMINI_IMAGE_SIZE || "",

    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: env.FITBASH_OPENAI_MODEL || "gpt-image-2.5-sunburst",
    openaiQuality: env.FITBASH_OPENAI_QUALITY || "medium",

    // The check runs only when a Claude credential is present.
    criticEnabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    criticModel: env.FITBASH_CRITIC_MODEL || "claude-opus-5-5",
    maxAttempts: int(env.FITBASH_MAX_ATTEMPTS, 2, 1, 4),

    accessCode: env.FITBASH_ACCESS_CODE || "",
    maxItems: 8,
  };
}
