/** Provider configuration helpers and model presets.
 * @module provider
 */

import type { ChatModelOptions } from "./model";

const isNode = typeof process !== "undefined" && !!process.versions?.node;

/** Ollama */

const OLLAMA_DEFAULT_ORIGIN = "http://localhost:11434";
const OLLAMA_PATH = "/api/chat";

export const OLLAMA_URL = (() => {
  let origin = OLLAMA_DEFAULT_ORIGIN;

  if (isNode && process.env.OLLAMA_HOST) {
    origin = process.env.OLLAMA_HOST.replace(/\/+$/, ""); // remove trailing slash(es)
  }

  return `${origin}${OLLAMA_PATH}`;
})();

export const ollama = (
  name: string,
  options?: Partial<ChatModelOptions>
): ChatModelOptions => ({
  url: OLLAMA_URL,
  name,
  stringifyContent: true,
  ...options
});

// Latest 24B Mistral Small in Ollama's official library.
export const MistralSmall = ollama("mistral-small3.2:24b");
export const DevstralSmall2 = ollama("devstral-small-2:24b");
export const Devstral2 = ollama("devstral-2:123b");
export const Devstral = DevstralSmall2;

export const Llama4Scout = ollama("llama4:16x17b");
export const Llama4Maverick = ollama("llama4:128x17b");

export const Gemma4Small = ollama("gemma4:e2b", { think: false });
export const Gemma4Mid = ollama("gemma4:26b", { think: false });

// Qwen 3.5 remains the current generation at the tiny and small sizes.
export const Qwen35Tiny = ollama("qwen3.5:0.8b", { think: false });
export const Qwen35TinyThink = ollama("qwen3.5:0.8b", { think: true });
export const Qwen35Small = ollama("qwen3.5:4b", { think: false });
export const Qwen38Mid = ollama("qwen3.8:27b", { think: false });

/** Legacy versioned presets retain their original model IDs. */

const llama32 = "llama3.2";
export const Llama32 = ollama(llama32);

const gemma3 = "gemma3:4b-it-qat";
const gemma3mid = "gemma3:27b-it-qat";
export const Gemma3Small = ollama(gemma3);
export const Gemma3Mid = ollama(gemma3mid);

const qwen3_06b = "qwen3:0.6b";
const qwen3_4b = "qwen3:4b";
const qwen3NoThink: Partial<ChatModelOptions> = {
  removeThink: true,
  noThinkPrompt: "\n\n/nothink"
};
export const Qwen3Tiny = ollama(qwen3_06b, qwen3NoThink);
export const Qwen3TinyThink = ollama(qwen3_06b);
export const Qwen3Small = ollama(qwen3_4b, qwen3NoThink);

/** LM Studio */

const LMS_DEFAULT_ORIGIN = "http://localhost:1234";
const LMS_PATH = "/v1/chat/completions";

export const lms = (
  name: string,
  options?: Partial<ChatModelOptions>
): ChatModelOptions => ({
  url: LMS_DEFAULT_ORIGIN + LMS_PATH,
  name,
  stringifyContent: true,
  ...options
});

const qwen3_14b_mlx = "qwen3-14b-mlx";
export const Qwen3MidMLX = lms(qwen3_14b_mlx, qwen3NoThink);

/** Load Qwen3.8 27B MLX with this custom identifier in LM Studio. */
export const Qwen38MidMLX = lms("qwen3.8-27b-mlx", {
  removeThink: true
});

/** OpenAI */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const chatgpt = (
  name: string,
  options?: Partial<ChatModelOptions>
): ChatModelOptions => {
  const api = options?.api ?? (name.startsWith("gpt-6") ? "responses" : "chat");
  return {
    url: api === "responses" ? OPENAI_RESPONSES_URL : OPENAI_URL,
    name,
    key: isNode ? process.env?.CHATGPT_KEY : undefined,
    stringifyArguments: true,
    stringifyContent: true,
    ...options,
    api
  };
};

export const ChatGPT6Astra = chatgpt("gpt-6-astra");
export const ChatGPT56Sol = chatgpt("gpt-5.6-sol");
export const ChatGPT56Terra = chatgpt("gpt-5.6-terra");
export const ChatGPT56Luna = chatgpt("gpt-5.6-luna");

/** Legacy versioned presets retain their original model IDs. */
const gpt4o = "gpt-4o";
const gpt41 = "gpt-4.1";
const gpt41mini = "gpt-4.1-mini";
const gpt41nano = "gpt-4.1-nano";
export const ChatGPT4o = chatgpt(gpt4o);
export const ChatGPT41 = chatgpt(gpt41);
export const ChatGPT41Mini = chatgpt(gpt41mini);
export const ChatGPT41Nano = chatgpt(gpt41nano);

/** OpenRouter */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Configure an OpenRouter model by its exact ID;
 * include the `:free` suffix to select a free variant.
 */
export const openrouter = (
  name: string,
  options?: Partial<ChatModelOptions>
): ChatModelOptions => ({
  url: OPENROUTER_URL,
  name,
  key: isNode ? process.env.OPENROUTER_API_KEY : undefined,
  stringifyContent: true,
  stringifyArguments: true,
  ...options
});

/** NVIDIA Nemotron 3 Ultra's free variant on OpenRouter. */
export const Nemotron3UltraFree = openrouter(
  "nvidia/nemotron-3-ultra-550b-a55b:free"
);
