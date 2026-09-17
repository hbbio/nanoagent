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

import { toText } from "./content";
import {
  AssistantMessage,
  type CompletionRequest,
  callToolAndAppend,
  type Message,
  type ToolCall
} from "./message";
import { Qwen3Small } from "./provider";
import { makeResponsesRequest, parseResponse } from "./responses";
import { type ChatMemory, type Tools, toolList } from "./tool";

// Preserve existing direct imports from the model module.
export * from "./provider";

/**
 * Options used when instantiating {@link ChatModel}.
 */
export interface ChatModelOptions {
  /** HTTP endpoint for the selected chat or Responses protocol. */
  url: string;
  /** Model identifier passed to the provider. */
  name: string;
  /** Wire protocol; existing providers default to Chat Completions. */
  api?: "chat" | "responses";
  /** Optional bearer token used for `Authorization: Bearer …`. */
  key?: string;
  /** Additional HTTP headers, e.g. OpenRouter app attribution. */
  headers?: Record<string, string>;
  /** Optional custom message‐adder used to merge assistant replies. */
  adder?: ChatMessageAdder;
  /** Tool arguments must be stringified (OpenAI) */
  stringifyArguments?: boolean;
  /** Serialize message content as text for chat-completion providers. */
  stringifyContent?: boolean;
  /** Override temperature for all messages */
  temperature?: number;
  /** Reasoning effort for the Responses API. */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Remove thinking */
  removeThink?: boolean;
  /** No thinking prompt */
  noThinkPrompt?: string;

  /** Custom response parsing */
  customResponse?: (res: Response) => Promise<AssistantMessage>;
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

export type CompleteOptions<Memory extends ChatMemory> = {
  memory?: Memory;
  tools?: Tools<Memory>;
  /** callback on streaming output */
  onOutput?: (progress: string) => void;
};

/**
 * Minimal interface a model must implement to be usable by the agent loop.
 */
export interface Model {
  /** Provider model identifier (e.g. "gpt-6-astra"). */
  name?: string;
  /**
   * Produce the next assistant turn — including any tool calls — and return the
   * updated transcript plus (possibly updated) memory.
   */
  complete: <Memory extends ChatMemory>(
    input: readonly Message[],
    options?: CompleteOptions<Memory>
  ) => Promise<{ messages: readonly Message[]; memory: Memory }>;
  /** Abort an in-flight request. */
  stop: () => Promise<void>;
}

/**
 * Concrete HTTP chat‑model wrapper.
 *
 * Supports chat-completion and Responses endpoints. Streaming chat responses
 * require a `customResponse` parser; `stop()` cancels the underlying fetch.
 */
export class ChatModel implements Model {
  readonly name: string;
  readonly options: ChatModelOptions;

  private readonly url: string;
  private readonly key?: string;
  private readonly adder: ChatMessageAdder;
  private _abortCtl: AbortController | null = null;

  constructor({ adder, ...opts }: ChatModelOptions = Qwen3Small) {
    this.options = opts;
    const { url, name, key } = opts;
    this.url = url;
    this.name = name;
    this.key = key;
    this.adder = adder ?? defaultAdder;
  }

  private _formatMessages(messages: readonly Message[]) {
    // Responses state must not leak into requests to chat-completion providers.
    const history = messages.map((msg) => {
      if (msg.role !== "assistant" || !msg.responseOutput) return msg;
      const { responseOutput: _output, ...message } = msg;
      return message;
    });
    if (!this.options.stringifyContent && !this.options.stringifyArguments)
      return history;
    return history.map((msg, i) => ({
      ...msg,
      ...(this.options.stringifyContent
        ? {
            content: msg.content
              ? toText(msg.content) +
                (i === messages.length - 1 && this.options.removeThink
                  ? this.options.noThinkPrompt || ""
                  : "")
              : null
          }
        : {}),
      ...(this.options.stringifyArguments &&
      msg.role === "assistant" &&
      msg.tool_calls
        ? {
            tool_calls: msg.tool_calls.map((call) => ({
              ...call,
              function: {
                ...call.function,
                arguments:
                  typeof call.function.arguments === "string"
                    ? call.function.arguments
                    : JSON.stringify(call.function.arguments)
              }
            }))
          }
        : {})
    }));
  }

  private _finalize(
    raw:
      | {
          message?:
            | AssistantMessage
            | { content: string; tool_calls?: ToolCall[] };
        }
      | { choices: AssistantMessage[] }
  ) {
    const msg =
      "message" in raw && raw.message && "content" in raw.message
        ? raw.message
        : "choices" in raw &&
            Array.isArray(raw.choices) &&
            raw.choices?.length &&
            // @todo support multiple choices
            raw.choices[0] &&
            "message" in raw.choices[0]
          ? (raw.choices[0].message as AssistantMessage)
          : null;
    if (!msg) {
      console.log({ raw });
      throw new Error("no message");
    }
    const message = AssistantMessage(
      this.options.removeThink && typeof msg.content === "string"
        ? removeThinkSection(msg.content)
        : msg.content || "",
      msg?.tool_calls
    );
    return { message };
  }

  /**
   * Execute a completion request and normalize the assistant message.
   * Responses output items are retained on the message for subsequent turns.
   */
  async invoke(
    chat: CompletionRequest
  ): Promise<{ message: AssistantMessage }> {
    const request =
      this.options.api === "responses"
        ? makeResponsesRequest(chat, this.options)
        : {
            ...chat,
            temperature: chat.temperature ?? this.options.temperature,
            messages: this._formatMessages(chat.messages)
          };
    if (this._abortCtl) this._abortCtl.abort();
    const abortCtl = new AbortController();
    this._abortCtl = abortCtl;

    const headers = new Headers(this.options.headers);
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json; charset=utf-8");
    if (this.key) headers.set("Authorization", `Bearer ${this.key}`);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: abortCtl.signal
      });
      if (!res.ok) throw new Error(await res.text());
      if (this.options.api === "responses")
        return { message: parseResponse(await res.json()) };

      const raw = this.options.customResponse
        ? { message: await this.options.customResponse(res) }
        : ((await res.json()) as { message: AssistantMessage });
      return this._finalize(raw);
    } finally {
      if (this._abortCtl === abortCtl) this._abortCtl = null;
    }
  }

  /** Build a provider‑specific completion request.  */
  async makeRequest<Memory extends ChatMemory>(
    messages: readonly Message[],
    tools?: Tools<Memory>
  ): Promise<CompletionRequest> {
    const availableTools = tools ? await toolList(tools) : [];
    return {
      model: this.name,
      messages: messages as Message[],
      stream: !!this.options.customResponse, // @todo explicit option?
      ...(availableTools.length
        ? { tools: availableTools, tool_choice: "auto" }
        : {})
    };
  }

  /** @inheritdoc */
  async complete<Memory extends ChatMemory>(
    input: readonly Message[],
    options?: CompleteOptions<Memory>
  ) {
    const { message } = await this.invoke(
      await this.makeRequest(input, options?.tools)
    );
    const merged = await this.adder(input, message);
    return callToolAndAppend(
      merged,
      options?.memory || ({} as Memory),
      options?.tools
    );
  }

  /** @inheritdoc */
  stop = async () => {
    if (this._abortCtl) {
      this._abortCtl.abort();
      this._abortCtl = null;
    }
  };
}
