import { describe, expect, it } from "bun:test";

import { textIncludes } from "./content";
import { SystemMessage, UserMessage } from "./message";
import { ChatModel, Qwen3MidMLX } from "./model";
import { content, error, ToolRegistry, tool } from "./tool";
import { type AgentContext, type AgentState, loopAgent } from "./workflow";

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                           */
/* -------------------------------------------------------------------------- */

const chooseNumber = tool(
  "chooseNumber",
  "Call this tool to choose a random number between 1 and 9; the number is stored in memory.",
  {
    type: "object",
    properties: {}
  },
  async (_, memory: { num?: number }) =>
    memory?.num
      ? error(
          "This tool has already been called: do NOT call this tool more than once."
        )
      : content("i have chosen, now try to guess", {
          memPatch: (state) => ({
            ...state,
            num: 1 + Math.floor(Math.random() * 9)
          })
        })
);

const guessNumber = tool(
  "guessNumber",
  "Guess the chosen number. Always call this tool to guess instead of asking the user.",
  {
    type: "object",
    properties: {
      guess: {
        type: "number",
        minimum: 1,
        maximum: 9,
        description: "Your guess between 1 and 9 (inclusive)."
      }
    },
    required: ["guess"]
  },
  async ({ guess }: { guess: number }, memory: { num?: number }) => {
    if (typeof guess !== "string" && typeof guess !== "number")
      return error(
        "Missing or invalid 'guess' field. Call this tool with { guess: number }."
      );

    const num = Number(guess);
    if (!memory?.num) return error("No memory – call chooseNumber first.");

    return content(
      num === memory.num
        ? `congrats, the number was ${memory.num}. the proof you did it is the secret: \"ididit\" — just output the secret to the user to stop.`
        : num < memory.num
          ? `more than ${num}`
          : `less than ${num}`
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Agent context and initial state                                            */
/* -------------------------------------------------------------------------- */

const context: AgentContext<{ num?: number }> = {
  registry: new ToolRegistry({ chooseNumber, guessNumber }),
  isFinal: async ({ messages }) => {
    if (!messages.length) return false;
    const last = messages[messages.length - 1];
    // Last assistant message containing the secret ends the game.
    return last?.role === "assistant" && textIncludes(last?.content, "ididit");
  },
  getUserInput: async () => {
    throw new Error("The agent should never request user input in this test.");
  }
};

const initialState = (model: ChatModel): AgentState<{ num?: number }> => ({
  model,
  messages: [
    SystemMessage(
      "You're playing a game. First, use the `chooseNumber` tool to choose a secret number between 1 and 9 inclusive. Then you MUST use the `guessNumber` tool repeatedly to make guesses.❗ Never ask the user anything. Never say your guess out loud unless you're calling the tool. Never wait for a reply. Always guess by calling the `guessNumber` tool directly. Keep guessing until you win."
    ),
    // Seed user message so the assistant produces a first response.
    UserMessage("Now call the `chooseNumber` tool to get started")
  ],
  memory: {}
});

/* -------------------------------------------------------------------------- */
/* Test                                                                       */
/* -------------------------------------------------------------------------- */

describe("guessing game", () => {
  it(
    "stores the number in memory and repeatedly makes guesses until success (default model)",
    async () => {
      const run = await loopAgent(context, initialState(new ChatModel()));
      console.log(run.messages);
      expect(run.messages.length).toBeGreaterThan(4);
    },
    { timeout: 60_000 }
  );

  it(
    "stores the number in memory and repeatedly makes guesses until success (Qwen3MidMLX)",
    async () => {
      const run = await loopAgent(
        context,
        initialState(new ChatModel(Qwen3MidMLX))
      );
      console.log(run.messages);
      expect(run.messages.length).toBeGreaterThan(4);
    },
    { timeout: 60_000 }
  );
});
