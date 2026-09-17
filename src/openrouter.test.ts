import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import {
  ChatModel,
  content,
  Nemotron3UltraFree,
  ollama,
  openrouter,
  SystemMessage,
  tool,
  toText,
  UserMessage
} from "./index";

const reply = (text: string) =>
  Response.json({
    choices: [{ message: { role: "assistant", content: text } }]
  });

describe("OpenRouter", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(reply("Hello!"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("uses the named free model and reads the key when configured", async () => {
    expect(Nemotron3UltraFree.name).toBe(
      "nvidia/nemotron-3-ultra-550b-a55b:free"
    );
    const model = new ChatModel(
      openrouter("nvidia/nemotron-3-ultra-550b-a55b:free")
    );
    const result = await model.complete([
      SystemMessage("Be concise."),
      UserMessage("Hi")
    ]);

    expect(toText(result.messages.at(-1)?.content)).toBe("Hello!");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-openrouter-key");
    expect(headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hi" }
      ],
      stream: false
    });
  });

  it.each(["nvidia/nemotron-3-ultra-550b-a55b:free", "test/paid-model"])(
    "preserves the selected model %s and supports explicit options",
    async (name) => {
      const model = new ChatModel(
        openrouter(name, {
          key: "explicit-key",
          temperature: 0,
          headers: {
            "HTTP-Referer": "https://example.com",
            "X-OpenRouter-Title": "NanoAgent test"
          }
        })
      );
      await model.complete([UserMessage("Hi")], { tools: {} });

      const [, init] = fetchSpy.mock.calls[0] ?? [];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer explicit-key");
      expect(headers.get("HTTP-Referer")).toBe("https://example.com");
      expect(headers.get("X-OpenRouter-Title")).toBe("NanoAgent test");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(name);
      expect(body.temperature).toBe(0);
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("tool_choice");
    }
  );

  it("does not send an undefined bearer token when no key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await new ChatModel(
      openrouter("nvidia/nemotron-3-ultra-550b-a55b:free")
    ).complete([UserMessage("Hi")]);
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("preserves Ollama content formatting and its no-thinking prompt", async () => {
    const model = new ChatModel(
      ollama("local-model", {
        removeThink: true,
        noThinkPrompt: "\n\n/nothink"
      })
    );
    fetchSpy.mockResolvedValue(
      Response.json({
        message: {
          role: "assistant",
          content: "<think>Internal reasoning</think>Hello!"
        }
      })
    );
    const messages = [SystemMessage("Be concise."), UserMessage("Hi")];
    const result = await model.complete(messages);
    expect(toText(result.messages.at(-1)?.content)).toBe("Hello!");
    expect(toText(messages[1]?.content)).toBe("Hi");

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body)).messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi\n\n/nothink" }
    ]);
  });

  it("executes tools and sends their results and arguments on the next turn", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "echo", arguments: { text: "hello" } }
                  },
                  {
                    id: "call_2",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: '{"text":"world"}'
                    }
                  }
                ]
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(reply("HELLO WORLD"));

    const echo = tool<{ text: string }, string, { count: number }>(
      "echo",
      "Echo uppercase text",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      },
      async ({ text }) =>
        content(text.toUpperCase(), {
          memPatch: (state) => ({ count: state.count + 1 })
        })
    );
    const tools = { echo };
    const model = new ChatModel(
      openrouter("nvidia/nemotron-3-ultra-550b-a55b:free")
    );
    const first = await model.complete([UserMessage("Echo hello and world")], {
      tools,
      memory: { count: 0 }
    });
    expect(first.memory.count).toBe(2);
    const snapshot = structuredClone(first.messages);
    const final = await model.complete(first.messages, {
      tools,
      memory: first.memory
    });

    expect(toText(final.messages.at(-1)?.content)).toBe("HELLO WORLD");
    expect(first.messages).toEqual(snapshot);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchSpy.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toEqual([echo.tool]);
      expect(body.tool_choice).toBe("auto");
    }
    const [, init] = fetchSpy.mock.calls[1] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.messages[1].tool_calls[0].function.arguments).toBe(
      '{"text":"hello"}'
    );
    expect(body.messages[1].tool_calls[1].function.arguments).toBe(
      '{"text":"world"}'
    );
    expect(body.messages.slice(-2)).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "HELLO" },
      { role: "tool", tool_call_id: "call_2", content: "WORLD" }
    ]);
  });

  it.each([401, 429, 503])(
    "surfaces HTTP %i errors without retrying or switching models",
    async (status) => {
      fetchSpy.mockResolvedValue(
        Response.json({ error: { message: "Request unavailable" } }, { status })
      );
      const model = new ChatModel(
        openrouter("nvidia/nemotron-3-ultra-550b-a55b:free")
      );
      await expect(model.complete([UserMessage("Hi")])).rejects.toThrow(
        "Request unavailable"
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  );
});
