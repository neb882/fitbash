import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createMockProvider } from "./mock.js";
import { ProviderError } from "./errors.js";

export { ProviderError };

/** The image models a person can pick, with what each needs. */
export const PROVIDERS = {
  mock: { label: "Preview collage (no key needed)" },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-nano-banana-2.1",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-image-2.5-sunburst",
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

/**
 * Build the image provider a person chose in Settings.
 * @param {{provider: string, geminiKey?: string, geminiModel?: string, openaiKey?: string, openaiModel?: string}} settings
 */
export function createProvider(settings) {
  switch (settings.provider) {
    case "gemini":
      if (!settings.geminiKey) throw new ProviderError("Add your Gemini API key in Settings first.");
      return createGeminiProvider({
        apiKey: settings.geminiKey,
        model: settings.geminiModel || PROVIDERS.gemini.defaultModel,
      });
    case "openai":
      if (!settings.openaiKey) throw new ProviderError("Add your OpenAI API key in Settings first.");
      return createOpenAIProvider({
        apiKey: settings.openaiKey,
        model: settings.openaiModel || PROVIDERS.openai.defaultModel,
        quality: "medium",
      });
    default:
      return createMockProvider();
  }
}
