/** Translation between NanoAgent messages and the OpenAI Responses API. */
import { type Content, toText } from "./content";
import {
  AssistantMessage,
  type CompletionRequest,
  type Message,
  type ResponseItem,
  type ToolCall
} from "./message";
import type { ChatModelOptions } from "./model";

const responseContent = (content: Content | null) => {
  if (content?.type === "image_url")
    return [{ type: "input_image", image_url: content.image_url.url }];
  if (content?.type === "image")
    return [
      {
        type: "input_image",
        image_url: `data:${content.mimeType ?? "image/png"};base64,${content.data}`
      }
    ];
  return toText(content) ?? "";
};

const responseInput = (messages: readonly Message[]) => {
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.responseOutput) {
      input.push(...message.responseOutput);
      continue;
    }
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: responseContent(message.content)
      });
      continue;
    }
    if (message.role === "function")
      throw new Error("Responses requires tool messages with a tool_call_id.");

    const content = responseContent(message.content);
    if (message.role !== "assistant" || content !== "")
      input.push({ role: message.role, content });

    if (message.role !== "assistant") continue;
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments:
          typeof call.function.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function.arguments)
      });
    }
  }
  return input;
};

/** Build a stateless Responses request without Chat Completions-only fields. */
export const makeResponsesRequest = (
  chat: CompletionRequest,
  options: ChatModelOptions
) => {
  if (chat.stream || options.customResponse)
    throw new Error(
      "The Responses adapter currently supports non-streaming JSON only."
    );
  for (const key of [
    "n",
    "stop",
    "seed",
    "presence_penalty",
    "frequency_penalty",
    "logit_bias"
  ] as const) {
    if (chat[key] !== undefined)
      throw new Error(
        `Responses does not support the '${key}' request option.`
      );
  }
  const temperature = chat.temperature ?? options.temperature;
  if (
    chat.model.startsWith("gpt-6") &&
    (temperature !== undefined || chat.top_p !== undefined)
  )
    throw new Error(
      "GPT-6 does not support temperature or top_p; use reasoningEffort."
    );

  const tools = chat.tools?.map(({ function: fn }) => ({
    type: "function",
    ...fn,
    // Keep optional tool arguments optional, as in Chat Completions.
    strict: false
  }));
  return {
    model: chat.model,
    input: responseInput(chat.messages),
    store: false,
    stream: false,
    max_output_tokens: chat.max_tokens,
    temperature,
    top_p: chat.top_p,
    user: chat.user,
    reasoning: options.reasoningEffort
      ? { effort: options.reasoningEffort }
      : undefined,
    ...(tools?.length
      ? {
          tools,
          tool_choice:
            typeof chat.tool_choice === "object"
              ? { type: "function", name: chat.tool_choice.function.name }
              : (chat.tool_choice ?? "auto")
        }
      : {})
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Normalize output for the agent loop while retaining all native output items. */
export const parseResponse = (raw: unknown): AssistantMessage => {
  if (!isRecord(raw)) throw new Error("Invalid Responses API response.");
  if (isRecord(raw.error))
    throw new Error(String(raw.error.message ?? "Responses API error."));
  if (raw.status !== "completed") {
    const reason = isRecord(raw.incomplete_details)
      ? raw.incomplete_details.reason
      : undefined;
    throw new Error(
      `Responses API returned ${raw.status ?? "no status"}${reason ? `: ${reason}` : ""}.`
    );
  }
  if (!Array.isArray(raw.output))
    throw new Error("Responses API response has no output array.");

  const output: ResponseItem[] = [];
  const texts: string[] = [];
  const calls: ToolCall[] = [];
  for (const item of raw.output) {
    if (!isRecord(item) || typeof item.type !== "string")
      throw new Error("Invalid Responses API output item.");
    output.push(item as ResponseItem);
    if (item.type === "function_call") {
      if (
        typeof item.call_id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.arguments !== "string"
      )
        throw new Error("Invalid Responses API function call.");
      calls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments }
      });
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === "output_text" && typeof part.text === "string")
        texts.push(part.text);
      if (part.type === "refusal" && typeof part.refusal === "string")
        texts.push(part.refusal);
    }
  }
  if (!texts.length && !calls.length)
    throw new Error("Responses API returned no assistant text or tool calls.");
  return {
    ...AssistantMessage(texts.join("\n"), calls.length ? calls : undefined),
    responseOutput: output
  };
};
