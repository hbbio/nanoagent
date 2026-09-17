import { describe, expect, it } from "bun:test";

import { toText } from "./content";
import {
  AssistantMessage,
  callToolAndAppend,
  type Message,
  type ToolCall,
  UserMessage
} from "./message";
import { typedSchema } from "./schema";
import { content, tool } from "./tool";

type EmptyArgs = Record<string, never>;

interface TestMemory extends Record<string, unknown> {
  count: number;
  history: string[];
  observed?: number;
}

const emptyArgsSchema = typedSchema<EmptyArgs>({
  type: "object",
  properties: {}
});

const increment = tool<EmptyArgs, string, TestMemory>(
  "increment",
  "Increment counter",
  emptyArgsSchema,
  async () =>
    content("increment", {
      memPatch: (state) => ({
        ...state,
        count: state.count + 1,
        history: [...state.history, `first:${state.count + 1}`]
      })
    })
);

const inspect = tool<EmptyArgs, string, TestMemory>(
  "inspect",
  "Verify memory after increment",
  emptyArgsSchema,
  async (_args, memory) => {
    if (memory.count !== 1) {
      throw new Error(`expected memory.count to be 1, got ${memory.count}`);
    }
    return content(`saw:${memory.count}`, {
      memPatch: (state) => ({
        ...state,
        history: [...state.history, `second-saw-${memory.count}`],
        observed: memory.count
      })
    });
  }
);

describe("callToolAndAppend", () => {
  it("applies memory patches sequentially across multiple tool calls", async () => {
    const toolCalls: ToolCall[] = [
      {
        id: "call_increment",
        type: "function",
        function: { name: "increment", arguments: "{}" }
      },
      {
        id: "call_inspect",
        type: "function",
        function: { name: "inspect", arguments: "{}" }
      }
    ];

    const messages: Message[] = [
      UserMessage("start"),
      AssistantMessage(null, toolCalls)
    ];

    const initialMemory: TestMemory = { count: 0, history: [] };
    const tools = { increment, inspect };

    const result = await callToolAndAppend(messages, initialMemory, tools);
    expect(result.messages).toHaveLength(4);
    const [firstTool, secondTool] = result.messages.slice(-2);
    expect(toText(firstTool?.content)).toBe("increment");
    expect(toText(secondTool?.content)).toBe("saw:1");
    expect(result.memory.count).toBe(1);
    expect(result.memory.observed).toBe(1);
    expect(result.memory.history).toEqual(["first:1", "second-saw-1"]);
  });
});
