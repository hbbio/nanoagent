import { describe, expect, it } from "bun:test";

import { toText } from "./content";
import {
  type AssistantMessage,
  type ToolCall,
  UserMessage,
  getToolArguments
} from "./message";
import { ChatModel, Llama32 } from "./model";
import { content, tool } from "./tool";

const weatherTool = "get_current_weather";
// @todo use TS inference from schema
const getCurrentWeather = tool(
  weatherTool,
  "Get the current weather for a location",
  {
    type: "object",
    properties: {
      location: {
        type: "string",
        description:
          "The location to get the weather for, e.g. San Francisco, CA"
      },
      format: {
        type: "string",
        description:
          "The format to return the weather in, e.g. 'celsius' or 'fahrenheit'",
        enum: ["celsius", "fahrenheit"]
      }
    },
    required: ["location", "format"]
  },
  async ({ location, format }: { location: string; format: string }) =>
    content({
      location,
      temperature: format === "celsius" ? "18°C" : "64°F",
      conditions: "Partly cloudy"
    })
);

describe("Weather tool", () => {
  it("calls get_current_weather with valid arguments", async () => {
    const toolCall: ToolCall = {
      id: "call_123",
      type: "function" as const,
      function: {
        name: "get_current_weather",
        arguments: JSON.stringify({
          location: "Paris",
          format: "celsius"
        })
      }
    };

    const parsedArgs = getToolArguments(toolCall.function.arguments);
    const result = await getCurrentWeather.handler(
      parsedArgs as { location: string; format: string },
      {}
    );

    expect(result?.content?.[0]).toEqual({
      type: "json",
      data: {
        location: "Paris",
        temperature: "18°C",
        conditions: "Partly cloudy"
      }
    });
  });
});

describe("OpenAI tool call (raw HTTP)", () => {
  const tools = { [weatherTool]: getCurrentWeather };

  it("should return a tool_call for get_current_weather", async () => {
    const model = new ChatModel(Llama32);
    const { message } = (await model.invoke(
      await model.makeRequest(
        [UserMessage("What's the weather like in Tokyo in celsius?")],
        tools
      )
    )) as { message: AssistantMessage };
    console.log(message?.tool_calls?.[0]);

    expect(message).toBeTruthy();
    const tool = message.tool_calls?.[0]?.function;
    expect(tool).toBeTruthy();

    // console.log({ message });
    expect(tool?.name).toBe("get_current_weather");
    const { location, format } = tool?.arguments as {
      location: string;
      format: string;
    };
    expect(location.toLowerCase()).toContain("tokyo");
    expect(format).toBe("celsius");
  }, 10_000); // 10s timeout

  it("two round tool use", async () => {
    const model = new ChatModel(Llama32);
    // call the chat and automatically call the tool
    const input = [UserMessage("What's the weather like in Tokyo in celsius?")];
    const { messages } = await model.complete(input, {}, tools);
    expect(messages).toBeTruthy();
    expect(messages.length).toBe(3);

    // second round: call the LLM again
    const final = await model.complete(messages); // no tools
    expect(final).toBeTruthy();
    expect(final.messages.length).toBe(4);
    const content = toText(final?.messages?.[3]?.content)?.toLowerCase();
    expect(content).toContain("tokyo");
    expect(content).toContain("18");
  }, 10_000); // 10s timeout
});
