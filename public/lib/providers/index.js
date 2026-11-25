import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createMockProvider } from "./mock.js";
import { createLocalProvider } from "./local.js";
import { ProviderError } from "./errors.js";

export { ProviderError };

/** The image services a person can connect, with the words the Setup panel shows for each. */
export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    hint: "easiest to set up",
    company: "Google",
    defaultModel: "gemini-nano-banana-2.1",
    keyUrl: "https://aistudio.google.com/apikey",
    openKeyPage: "Open Google's key page",
    signIn: "and sign in with your Google account.",
    createKey: "Press “Create API key” there, then copy the key it shows you.",
    note: "Google only makes pictures for keys that have billing turned on. If it asks you to set up billing, that is expected: pictures cost a few cents each.",
  },
  openai: {
    label: "OpenAI",
    hint: "more steps",
    company: "OpenAI",
    defaultModel: "gpt-image-2.5-sunburst",
    keyUrl: "https://platform.openai.com/api-keys",
    openKeyPage: "Open OpenAI's key page",
    signIn: "and sign in or create an account.",
    createKey: "Press “Create new secret key” there, then copy the key it shows you.",
    note: "OpenAI only makes pictures once you have added credit and verified your identity in its settings. Google is usually quicker.",
  },
  // No key and no bill: a model on the person's own computer. Setup shows
  // different steps for it (public/lib/providers/local.js).
  local: {
    label: "This computer",
    hint: "free, needs a good graphics card",
    local: true,
  },
};

export const DEFAULT_PROVIDER = "gemini";

/**
 * Build the image provider for a person's settings. Any provider other than
 * the real ones gives the keyless collage stand-in.
 * @param {{provider: string, geminiKey?: string, geminiModel?: string, openaiKey?: string, openaiModel?: string, localUrl?: string, localModel?: string}} settings
 */
export function createProvider(settings) {
  switch (settings.provider) {
    case "gemini":
      if (!settings.geminiKey) throw new ProviderError("Add your Google key in Setup first.");
      return createGeminiProvider({
        apiKey: settings.geminiKey,
        model: settings.geminiModel || PROVIDERS.gemini.defaultModel,
      });
    case "openai":
      if (!settings.openaiKey) throw new ProviderError("Add your OpenAI key in Setup first.");
      return createOpenAIProvider({
        apiKey: settings.openaiKey,
        model: settings.openaiModel || PROVIDERS.openai.defaultModel,
        quality: "medium",
      });
    case "local":
      if (!settings.localModel) throw new ProviderError("Connect to the app on your computer in Setup first.");
      return createLocalProvider({ baseUrl: settings.localUrl, model: settings.localModel });
    default:
      return createMockProvider();
  }
}
