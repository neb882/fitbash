import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createMockProvider } from "./mock.js";

export { ProviderError } from "./errors.js";

/** Build the image provider named in the config. Throws when its key is missing. */
export function createProvider(config) {
  switch (config.provider) {
    case "gemini":
      if (!config.geminiApiKey) throw new Error("FITBASH_PROVIDER=gemini needs GEMINI_API_KEY.");
      return createGeminiProvider({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        imageSize: config.geminiImageSize,
      });
    case "openai":
      if (!config.openaiApiKey) throw new Error("FITBASH_PROVIDER=openai needs OPENAI_API_KEY.");
      return createOpenAIProvider({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        quality: config.openaiQuality,
      });
    case "mock":
      return createMockProvider();
    default:
      throw new Error(`Unknown FITBASH_PROVIDER "${config.provider}". Use mock, gemini or openai.`);
  }
}
