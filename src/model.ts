import { toText } from "./content";
import {
  AssistantMessage,
  type CompletionRequest,
  type Message,
  type ToolCall,
  callToolAndAppend
} from "./message";
import { type ChatMemory, type Tools, toolList } from "./tool";

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

const mistralSmall = "mistral-small3.1";
export const MistralSmall = ollama(mistralSmall);

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

/** OpenAI */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export const chatgpt = (name: string): ChatModelOptions => ({
  url: OPENAI_URL,
  name,
  key: process?.env?.CHATGPT_KEY,
  stringifyArguments: true
});

const gpt4o = "gpt-4o";
const gpt41 = "gpt-4.1";
const gpt41mini = "gpt-4.1-mini";
const gpt41nano = "gpt-4.1-nano";
export const ChatGPT4o = chatgpt(gpt4o);
export const ChatGPT41 = chatgpt(gpt41);
export const ChatGPT41Mini = chatgpt(gpt41mini);
export const ChatGPT41Nano = chatgpt(gpt41nano);

/**
 * Minimal remote chat‑model wrapper with optional streaming and graceful
 * cancellation.  Designed for the NanoAgent framework.
 *
 * ## Exports
 * - `ChatModelOptions` - constructor options understood by {@link ChatModel}.
 * - `ChatMessageAdder` - async helper that merges the assistant reply into the
 *   running transcript.
 * - `Model` - interface expected by the agent runtime.
 * - `ChatModel` - concrete implementation that talks to an OpenAI‑style HTTP
 *   endpoint.
 *
 * @module model
 */

/**
 * Options used when instantiating {@link ChatModel}.
 */
export interface ChatModelOptions {
  /** HTTP endpoint that accepts OpenAI‑style chat‑completions JSON. */
  url: string;
  /** Model identifier passed to the provider. */
  name: string;
  /** Optional bearer token used for `Authorization: Bearer …`. */
  key?: string;
  /** When `true`, requests a chunked streaming response. */
  stream?: boolean;
  /** Optional custom message‐adder used to merge assistant replies. */
  adder?: ChatMessageAdder;
  /** Tool arguments must be stringified (OpenAI) */
  stringifyArguments?: boolean;
  /** Messages content should be stringified (ollama) */
  stringifyContent?: boolean;
  /** Override temperature for all messages */
  temperature?: number;
  /** Remove thinking */
  removeThink?: boolean;
  /** No thinking prompt */
  noThinkPrompt?: string;
}

// @todo move to content?
export const removeThinkSection = (input: string): string => {
  const start = input.indexOf("<think>");
  const end = input.lastIndexOf("</think>");

  if (start === -1 || end === -1 || end < start) return input.trim();

  return (input.slice(0, start) + input.slice(end + "</think>".length)).trim();
};

/**
 * Default message‑adder: simply appends the assistant message to the history.
 */
export const defaultAdder = async (
  history: readonly Message[],
  assistant: Message
): Promise<readonly Message[]> => [...history, assistant];

/**
 * Signature for custom functions that merge the assistant reply into the
 * running transcript before the next agent step.
 */
export type ChatMessageAdder = typeof defaultAdder;

/**
 * Minimal interface a model must implement to be usable by the agent loop.
 */
export interface Model {
  /** Human‑readable model name (e.g. "gpt‑4o-mini"). */
  name?: string;
  /**
   * Produce the next assistant turn — including any tool calls — and return the
   * updated transcript plus (possibly updated) memory.
   */
  complete: <Memory extends ChatMemory>(
    input: readonly Message[],
    memory?: Memory,
    tools?: Tools<Memory>
  ) => Promise<{ messages: readonly Message[]; memory: Memory }>;
  /** Abort an in‑flight streaming request. */
  stop: () => Promise<void>;
}

/**
 * Concrete HTTP chat‑model wrapper.
 *
 * Supports streaming (`options.stream = true`) and exposes `stop()` which
 * cancels the underlying `fetch` via `AbortController`.
 */
export class ChatModel implements Model {
  readonly name: string;
  readonly options: ChatModelOptions;

  private readonly url: string;
  private readonly key?: string;
  private readonly stream: boolean;
  private readonly adder: ChatMessageAdder;
  private abortCtl: AbortController | null = null;

  constructor({ adder, ...opts }: ChatModelOptions = Qwen3Small) {
    this.options = opts;
    const { url, name, key, stream } = opts;
    this.url = url;
    this.name = name;
    this.key = key;
    this.stream = stream ?? false;
    this.adder = adder ?? defaultAdder;
  }

  private _formatMessages(messages: Message[]) {
    if (!this.options.stringifyContent) return messages;
    return messages.map((msg, i) => ({
      ...msg,
      content: msg.content
        ? toText(msg.content) +
          (i === messages.length - 1 && this.options?.removeThink
            ? this.options?.noThinkPrompt || ""
            : "")
        : null
    }));
  }

  private _finalize(raw: {
    message?: AssistantMessage | { content: string; tool_calls?: ToolCall[] };
  }) {
    if (!raw.message) throw new Error("no message");
    const message = AssistantMessage(
      this.options.removeThink &&
        raw.message?.content &&
        typeof raw.message.content === "string"
        ? removeThinkSection(raw.message.content)
        : raw.message.content,
      raw.message?.tool_calls
    );
    return { message };
  }

  /**
   * Execute a chat completion request and return the provider's raw payload.
   * Streaming responses are concatenated into a single JSON object containing
   * the final assistant message.
   */
  async invoke(
    chat: CompletionRequest
  ): Promise<{ message: AssistantMessage }> {
    if (this.abortCtl) this.abortCtl.abort();
    this.abortCtl = new AbortController();

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...chat,
        temperature: chat.temperature ?? this.options.temperature ?? undefined,
        messages: this._formatMessages(chat.messages)
      } as CompletionRequest),
      signal: this.abortCtl.signal
    });

    if (!res.ok) {
      this.abortCtl = null;
      throw new Error(await res.text());
    }

    if (!this.stream) {
      this.abortCtl = null;
      const raw = (await res.json()) as {
        message:
          | AssistantMessage
          | { content: string; tool_calls?: ToolCall[] };
      };
      return this._finalize(raw);
    }

    // biome-ignore lint/style/noNonNullAssertion: res.ok
    const reader = res.body!.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      buffer += decoder.decode();
    } finally {
      this.abortCtl = null;
    }

    const lines = buffer.trim().split(/\r?\n/).filter(Boolean);
    if (!lines?.length) return { message: AssistantMessage("") };
    // biome-ignore lint/style/noNonNullAssertion: lines.length > 0
    const last = lines[lines.length - 1]!;
    const jsonLine = last.startsWith("data:") ? last.slice(5) : last;
    const raw = JSON.parse(jsonLine);
    return this._finalize(raw);
  }

  /** Build a provider‑specific completion request.  */
  async makeRequest<Memory extends ChatMemory>(
    messages: readonly Message[],
    tools?: Tools<Memory>
  ): Promise<CompletionRequest> {
    return {
      model: this.name,
      messages: messages as Message[],
      stream: this.stream,
      tools: tools ? await toolList(tools) : undefined,
      tool_choice: "auto"
    };
  }

  /** @inheritdoc */
  async complete<Memory extends ChatMemory>(
    input: readonly Message[],
    memory: Memory = {} as Memory,
    tools?: Tools<Memory>
  ) {
    const { message } = await this.invoke(await this.makeRequest(input, tools));
    const merged = await this.adder(input, message);
    return callToolAndAppend(merged, memory, tools);
  }

  /** @inheritdoc */
  stop = async () => {
    if (this.abortCtl) {
      this.abortCtl.abort();
      this.abortCtl = null;
    }
  };
}
