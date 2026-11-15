import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import {
  ChatGPT56Luna,
  ChatModel,
  HaltKind,
  loopAgent,
  Qwen38MidMLX,
  toText,
  UserMessage
} from "./index";

describe("Current provider defaults", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        message: { role: "assistant", content: "Done" }
      })
    );
  });
  afterEach(() => fetchSpy.mockRestore());

  it("uses a small Qwen model and disables thinking without changing the prompt", async () => {
    await new ChatModel().complete([UserMessage("Hi")]);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "qwen3.5:4b",
      think: false,
      messages: [{ role: "user", content: "Hi" }]
    });
  });

  it("lets a request enable thinking over the preset default", async () => {
    const model = new ChatModel();
    await model.invoke({
      ...(await model.makeRequest([UserMessage("Hi")])),
      think: true
    });
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).think).toBe(true);
  });

  it("uses Gemma 4 for the workflow's default control check", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json({ message: { role: "assistant", content: "Done" } })
      )
      .mockResolvedValueOnce(
        Response.json({ message: { role: "assistant", content: "no" } })
      );
    const final = await loopAgent(
      { isFinal: async () => true },
      { model: new ChatModel(), messages: [UserMessage("Hi")] }
    );
    expect(final.halted?.kind).toBe(HaltKind.Done);
    const [, init] = fetchSpy.mock.calls[1] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gemma4:e2b",
      think: false
    });
  });

  it("keeps GPT-5.6 on Chat Completions with correctly formatted messages", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        choices: [{ message: { role: "assistant", content: "Hello" } }]
      })
    );
    await new ChatModel({ ...ChatGPT56Luna, key: "test-key" }).complete([
      UserMessage("Hi")
    ]);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5.6-luna",
      stream: false,
      messages: [{ role: "user", content: "Hi" }]
    });
  });

  it("uses the LM Studio Qwen3.8 identifier without an old no-thinking directive", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: "<think>Reasoning</think>Hello"
            }
          }
        ]
      })
    );
    const result = await new ChatModel(Qwen38MidMLX).complete([
      UserMessage("Hi")
    ]);
    expect(toText(result.messages.at(-1)?.content)).toBe("Hello");
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "qwen3.8-27b-mlx",
      stream: false,
      messages: [{ role: "user", content: "Hi" }]
    });
  });
});
