import {
  type AgentContext,
  type AgentState,
  type ChatMemory,
  ChatModel,
  Llama32,
  SystemMessage,
  ToolRegistry,
  UserMessage,
  content,
  lastMessageIncludes,
  loopAgent,
  tool
} from "../src";

// 1) a trivial tool
const echo = tool(
  "echo",
  "Echo user input back in uppercase",
  {
    type: "object",
    properties: { txt: { type: "string" } },
    required: ["txt"]
  },
  async ({ txt }: { txt: string }) => content(txt.toUpperCase())
);

// 2) agent context
const ctx: AgentContext<ChatMemory> = {
  registry: new ToolRegistry({ echo }),
  isFinal: lastMessageIncludes("HELLO")
};

// 3) initial state
const init: AgentState<ChatMemory> = {
  model: new ChatModel(Llama32),
  messages: [
    SystemMessage(
      "You must call the `echo` tool once. Reply very concisely and NEVER ASK any further question to the user!"
    ),
    UserMessage(
      "Call the tool with the parameter `hello` and tell me what is the response"
    )
  ]
};

// 4) run and display the whole conversation
const done = await loopAgent(ctx, init);
console.log(done.messages);
