import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import {
  AssistantMessage,
  ChatGPT6Astra,
  ChatModel,
  chatgpt,
  content,
  type Message,
  openrouter,
  SystemMessage,
  tool,
  toText,
  UserMessage
} from "./index";

const textOutput = {
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  phase: "final_answer",
  content: [{ type: "output_text", text: "Done.", annotations: [] }]
};
const response = (output: unknown[] = [textOutput]) =>
  Response.json({ id: "resp_1", status: "completed", output });

describe("Responses API", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response());
  });
  afterEach(() => fetchSpy.mockRestore());

  it("uses Responses for Astra and converts text, JSON, and image inputs", async () => {
    const model = new ChatModel({
      ...ChatGPT6Astra,
      key: "test-key",
      reasoningEffort: "low"
    });
    const result = await model.complete([
      SystemMessage("Be concise."),
      UserMessage("Hello"),
      UserMessage({ type: "json", data: { count: 2 } }),
      UserMessage({
        type: "image_url",
        image_url: { url: "https://example.com/image.png" }
      }),
      UserMessage({ type: "image", data: "abc", mimeType: "image/jpeg" })
    ]);
    expect(toText(result.messages.at(-1)?.content)).toBe("Done.");
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-key"
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: "gpt-6-astra",
      store: false,
      stream: false,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
        { role: "user", content: expect.any(String) },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "https://example.com/image.png" }
          ]
        },
        {
          role: "user",
          content: [
            { type: "input_image", image_url: "data:image/jpeg;base64,abc" }
          ]
        }
      ]
    });
    expect(JSON.parse(body.input[2].content)).toEqual({ count: 2 });
  });

  it("replays reasoning and multiple tool calls using call IDs, even with a new model instance", async () => {
    const output = [
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "opaque"
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "increment",
        arguments: "{}",
        status: "completed"
      },
      {
        type: "function_call",
        id: "fc_2",
        call_id: "call_2",
        name: "increment",
        arguments: "{}",
        status: "completed"
      }
    ];
    fetchSpy.mockResolvedValueOnce(response(output));
    const increment = tool<Record<string, never>, string, { count: number }>(
      "increment",
      "Increment the count",
      { type: "object", properties: {} },
      async (_args, memory) =>
        content(`count:${memory.count + 1}`, {
          memPatch: (state) => ({ count: state.count + 1 })
        })
    );
    const options = chatgpt("gpt-6-astra", { key: "test-key" });
    const tools = { increment };
    const first = await new ChatModel(options).complete(
      [UserMessage("Count twice")],
      {
        tools,
        memory: { count: 0 }
      }
    );
    expect(first.memory.count).toBe(2);
    expect(first.messages[1]).toMatchObject({
      tool_calls: [{ id: "call_1" }, { id: "call_2" }],
      responseOutput: output
    });
    // Serializable transcript state, not hidden state on a model instance.
    const history: readonly Message[] = JSON.parse(
      JSON.stringify(first.messages)
    );
    const final = await new ChatModel(options).complete(history, {
      tools,
      memory: first.memory
    });
    const [, init] = fetchSpy.mock.calls[1] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.input).toEqual([
      { role: "user", content: "Count twice" },
      ...output,
      { type: "function_call_output", call_id: "call_1", output: "count:1" },
      { type: "function_call_output", call_id: "call_2", output: "count:2" }
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "increment",
        description: "Increment the count",
        parameters: { type: "object", properties: {} },
        strict: false
      }
    ]);
    expect(final.messages.at(-1)).toMatchObject({
      responseOutput: [textOutput]
    });
    expect(history).toEqual(first.messages);

    fetchSpy.mockResolvedValue(
      Response.json({
        choices: [{ message: { role: "assistant", content: "Hello" } }]
      })
    );
    await new ChatModel(
      openrouter("nvidia/nemotron-3-ultra-550b-a55b:free")
    ).complete(final.messages);
    const [, chatInit] = fetchSpy.mock.calls[2] ?? [];
    const chatBody = JSON.parse(String(chatInit?.body));
    expect(chatBody.messages[1]).not.toHaveProperty("responseOutput");
    expect(chatBody.messages.at(-1)).not.toHaveProperty("responseOutput");
    expect(chatBody.messages[1].tool_calls[0].id).toBe("call_1");
  });

  it("converts existing tool transcripts and forced tool selection", async () => {
    const model = new ChatModel(chatgpt("gpt-6-astra", { key: "test-key" }));
    await model.invoke({
      model: model.name,
      messages: [
        AssistantMessage(null, [
          {
            id: "call_existing",
            type: "function",
            function: { name: "echo", arguments: { text: "Hi" } }
          }
        ]),
        {
          role: "tool",
          tool_call_id: "call_existing",
          content: { type: "text", text: "Hi" }
        }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "echo",
            parameters: { type: "object", properties: {} }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "echo" } },
      max_tokens: 123
    });
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.input).toEqual([
      {
        type: "function_call",
        call_id: "call_existing",
        name: "echo",
        arguments: '{"text":"Hi"}'
      },
      { type: "function_call_output", call_id: "call_existing", output: "Hi" }
    ]);
    expect(body.tool_choice).toEqual({ type: "function", name: "echo" });
    expect(body.max_output_tokens).toBe(123);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("keeps refusals as assistant text", async () => {
    fetchSpy.mockResolvedValue(
      response([
        {
          ...textOutput,
          content: [{ type: "refusal", refusal: "I cannot help with that." }]
        }
      ])
    );
    const result = await new ChatModel(ChatGPT6Astra).complete([
      UserMessage("Hi")
    ]);
    expect(toText(result.messages.at(-1)?.content)).toBe(
      "I cannot help with that."
    );
  });

  it.each([
    { temperature: 0.5 },
    { top_p: 0.9 },
    { stream: true },
    { stop: "done" }
  ])(
    "rejects unsupported request options before calling the API: %j",
    async (option) => {
      const model = new ChatModel(ChatGPT6Astra);
      await expect(
        model.invoke({ model: model.name, messages: [], ...option })
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it("does not execute partial tool calls from incomplete responses", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "write",
            arguments: "{}"
          }
        ]
      })
    );
    let calls = 0;
    const write = tool(
      "write",
      "Write data",
      { type: "object", properties: {} },
      async () => {
        calls++;
        return content("written");
      }
    );
    await expect(
      new ChatModel(ChatGPT6Astra).complete([UserMessage("Go")], {
        tools: { write }
      })
    ).rejects.toThrow("max_output_tokens");
    expect(calls).toBe(0);
  });

  it("surfaces API failures", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        status: "failed",
        error: { message: "Provider failed" },
        output: []
      })
    );
    await expect(
      new ChatModel(ChatGPT6Astra).complete([UserMessage("Hi")])
    ).rejects.toThrow("Provider failed");
  });

  it("cancels an in-flight Responses request", async () => {
    fetchSpy.mockImplementation(
      ((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        })) as typeof fetch
    );
    const model = new ChatModel(ChatGPT6Astra);
    const pending = model.invoke({ model: model.name, messages: [] });
    await model.stop();
    await expect(pending).rejects.toThrow("aborted");
  });
});
