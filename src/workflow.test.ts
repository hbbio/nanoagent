import { describe, expect, it } from "bun:test";

import { toContent, toText } from "./content";
import { type Message, SystemMessage, UserMessage } from "./message";
import {
  ChatModel,
  type CompleteOptions,
  Gemma3Small,
  MistralSmall,
  type Model
} from "./model";
import type { ChatMemory } from "./tool";
import type { AgentContext, AgentState } from "./workflow";
import { runWorkflow, Sequence, stepAgent } from "./workflow";
import { lastMessageIncludes } from "./yes";

const yesModel = new ChatModel(Gemma3Small);

describe("Sequence Chaining", () => {
  it(
    "should run two chained workflows with runAll",
    async () => {
      const model = new ChatModel(MistralSmall);

      const state1: AgentState<ChatMemory> = {
        model,
        messages: [
          SystemMessage("You must answer `ONE` to any user question"),
          UserMessage("What is the answer?")
        ]
      };
      const state2: AgentState<ChatMemory> = {
        model,
        messages: [
          SystemMessage("You must answer `TWO` to any user question"),
          UserMessage("What is the answer?")
        ]
      };
      const ctx2: AgentContext<ChatMemory> = {
        isFinal: lastMessageIncludes("TWO", { caseInsensitive: true }),
        getUserInput: async () => "hello"
      };
      const ctx1: AgentContext<ChatMemory> = {
        isFinal: lastMessageIncludes("ONE", { caseInsensitive: true }),
        nextSequence: async () => ({
          ctx: ctx2,
          state: state2,
          options: { preserveInput: true, yesModel }
        })
      };

      const wf = new Sequence(ctx1, state1, { maxSteps: 20, yesModel });
      const { final, history } = await runWorkflow(wf);

      expect(history.length).toBe(2);
      expect(final.halted).toMatchObject({ kind: "done" });
      expect(toText(final.messages.at(-1)?.content)?.toLowerCase()).toContain(
        "two"
      );
      // @ts-expect-error private and defined
      expect(history[1]._ctx?.getUserInput()).resolves.toBe("hello");
    },
    { timeout: 10_000 }
  );
});

// 1) Model that never advances (no new messages)
class NoProgressModel implements Model {
  async complete<Memory extends ChatMemory>(
    messages: readonly Message[],
    options?: CompleteOptions<Memory>
  ) {
    return { messages, memory: options?.memory || ({} as Memory) };
  }
  async stop() {}
}

describe("Controller Stuck #1: no new messages", () => {
  it("invokes controller when model produces no new messages", async () => {
    const model = new NoProgressModel();
    const initial = [
      SystemMessage("Guard: please respond"),
      UserMessage("Hello?")
    ];
    const state: AgentState<ChatMemory> = { model, messages: initial };

    // Controller appends a reminder SystemMessage
    const ctx: AgentContext<ChatMemory> = {
      isFinal: async () => false,
      controller: async (s) => ({
        ...s,
        messages: [
          ...s.messages,
          SystemMessage("Reminder: continue toward goal")
        ]
      })
    };

    const next = await stepAgent(ctx, state, { debug: false, yesModel });
    expect(next.messages.length).toBe(initial.length + 1);
    expect(toText(next.messages.at(-1)?.content)).toBe(
      "Reminder: continue toward goal"
    );
    expect(next.halted).toBeUndefined();
  });
});

// 2) Model that returns an assistant message with empty content
class EmptyAssistantModel implements Model {
  async complete<Memory extends ChatMemory>(
    messages: readonly Message[],
    options?: CompleteOptions<Memory>
  ) {
    // simulate assistant reply with empty content
    const reply = { role: "assistant" as const, content: toContent("") };
    return {
      messages: [...messages, reply],
      memory: options?.memory || ({} as Memory)
    };
  }

  async stop() {}
}

describe("Controller Stuck #2: empty assistant message", () => {
  it("invokes controller when assistant message is empty", async () => {
    const model = new EmptyAssistantModel();
    const initial = [
      SystemMessage("Guide: ask something"),
      UserMessage("Ping")
    ];
    const state: AgentState<ChatMemory> = { model, messages: initial };

    const ctx: AgentContext<ChatMemory> = {
      isFinal: async () => false,
      getUserInput: async () => "Write my resume",
      controller: async (s) => ({
        ...s,
        messages: [...s.messages, SystemMessage("Oops, still waiting for you")]
      })
    };

    const next = await stepAgent(ctx, state, { yesModel });
    // One empty assistant and then controller => total +2
    expect(toText(next.messages.at(-1)?.content)).toMatch(/waiting for you/);
    expect(next.messages.length).toBe(initial.length + 2);
  });
});

// 3) Model that returns two assistant messages in a row
class DoubleAssistantModel implements Model {
  private called = false;
  async complete<Memory extends ChatMemory>(
    messages: readonly Message[],
    options?: CompleteOptions<Memory>
  ) {
    if (!this.called) {
      this.called = true;
      // first call: assistant with content
      return {
        messages: [
          ...messages,
          { role: "assistant" as const, content: toContent("Sure, working...") }
        ],
        memory: options?.memory || ({} as Memory)
      };
    }
    // second call: assistant again
    return {
      messages: [
        ...messages,
        { role: "assistant" as const, content: toContent("Next step...") }
      ],
      memory: options?.memory || ({} as Memory)
    };
  }

  async stop() {}
}

describe("Controller Stuck #2: consecutive assistant messages", () => {
  it("invokes controller when two assistant messages in a row", async () => {
    const model = new DoubleAssistantModel();
    const initial = [SystemMessage("Start"), UserMessage("Go")] as const;
    let state: AgentState<ChatMemory> = { model, messages: initial };

    const ctx: AgentContext<ChatMemory> = {
      isFinal: async () => false,
      controller: async (s) => ({
        ...s,
        messages: [...s.messages, SystemMessage("Please refocus on the task")]
      })
    };

    // First step adds one assistant message
    state = await stepAgent(ctx, state, { yesModel });
    expect(state.messages.at(-1)?.role).toBe("assistant");

    // Second step: another assistant => triggers controller
    state = await stepAgent(ctx, state, { yesModel });
    expect(toText(state.messages.at(-1)?.content)).toBe(
      "Please refocus on the task"
    );
  });
});

// 4) Full workflow with Sequence and controller
class FlakyModel implements Model {
  private count = 0;
  async complete<Memory extends ChatMemory>(
    messages: readonly Message[],
    options?: CompleteOptions<Memory>
  ) {
    this.count++;
    if (this.count < 2) {
      // no progress
      return { messages, memory: options?.memory || ({} as Memory) };
    }
    // then make progress
    return {
      messages: [
        ...messages,
        { role: "assistant" as const, content: toContent("Done") }
      ],
      memory: options?.memory || ({} as Memory)
    };
  }

  async stop() {}
}

describe("Sequence with controller recovers from stuck state", () => {
  it("uses controller then completes after retry", async () => {
    const model = new FlakyModel();
    const initial: AgentState<ChatMemory> = {
      model,
      messages: [SystemMessage("Begin"), UserMessage("Proceed")]
    };
    const ctx: AgentContext<ChatMemory> = {
      getUserInput: async () => "help me",
      isFinal: async (s) =>
        s.messages.some(
          (m) => m.role === "assistant" && toText(m.content) === "Done"
        ),
      controller: async (s) => ({
        ...s,
        messages: [...s.messages, SystemMessage("Keep going")]
      })
    };

    const seq = new Sequence(ctx, initial, { yesModel, maxSteps: 10 });
    const { final } = await runWorkflow(seq);
    // final should include both reminder and the Done reply
    const contents = final.messages.map((m) => m.content);

    expect(contents).toMatchObject([
      { type: "text", text: "Begin" },
      { type: "text", text: "Proceed" },
      { type: "text", text: "Keep going" },
      { type: "text", text: "Done" }
    ]);
  });
});
