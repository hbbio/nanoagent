<p align="center">
  <img src="./logo.png" alt="NanoAgent Logo" width="150" />
</p>

# NanoAgent

**NanoAgent** is a micro‑framework (≈ 1 kLOC) for running LLM‑powered agents
in pure TypeScript **with zero runtime dependencies** outside of
[bun](https://bun.sh). You only need your favorite chat models: OpenAI, or a
local engine like Ollama.

> **Why another agent runtime?**  
> [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction)
> is bringing the opportunity to de-clutter agent frameworks. Most features
> should be tools, retrieval sources, etc. in a standard JSON envelope, then
> hand that context to any model. NanoAgent focuses on one job: **the control
> loop** and leaves RAG, vector search, databases and cloud calls to
> MCP‑compatible tools. The result is a tiny, transparent core you can audit
> in an afternoon.

Note that this projects implements a few extensions over the current
specifications of MCP and/or tool calling.

## Highlights

- **Pure functions, repeatable runs** – every step returns a new `AgentState`;
  nothing mutates in place.
- **Deterministic stepping** – `stepAgent` drives exactly one model call →
  tool call → state update.
- **Built‑in stuck detection** – empty answers, duplicate assistant messages
  or missing tool output trigger a recovery hook.
- **Halting reasons** – `await_user`, `tool_error`, `done`, `stopped`.
- **Multi‑stage workflows** – chain `Sequence` objects for wizard‑style flows.
- **JSON‑Schema tools** – validate inputs at the boundary, patch memory with
  pure lambdas.
- **No hidden packages** – just TypeScript.
- **First‑class Bun support** – fast test runner, edge‑ready.

## Quick tour

```ts
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
  tool,
} from "@hbbio/nanoagent";

// 1) a trivial tool
const echo = tool(
  "echo",
  "Echo user input back in uppercase",
  {
    type: "object",
    properties: { txt: { type: "string" } },
    required: ["txt"],
  },
  async ({ txt }: { txt: string }) => content(txt.toUpperCase()),
);

// 2) agent context
const ctx: AgentContext<ChatMemory> = {
  registry: new ToolRegistry({ echo }),
  isFinal: lastMessageIncludes("HELLO"),
};

// 3) initial state
const init: AgentState<ChatMemory> = {
  model: new ChatModel(Llama32),
  messages: [
    SystemMessage(
      "You must call the `echo` tool once. Reply very concisely and NEVER ASK any further question to the user!",
    ),
    UserMessage(
      "Call the tool with the parameter `hello` and tell me what is the response",
    ),
  ],
};

// 4) run and display the whole conversation
const done = await loopAgent(ctx, init);
console.log(done.messages);
```

Run it with Bun:

```bash
bun run examples/echo.ts
```

## Concepts in 60 seconds

| Concept        | What it holds                                            |
| -------------- | -------------------------------------------------------- |
| `AgentState`   | Immutable snapshot: model driver, messages, memory, halt |
| `AgentContext` | Pure hooks: goal test, tool registry, controller, etc.   |
| `stepAgent`    | One transition – may call the model and at most one tool |
| `loopAgent`    | While‑loop around `stepAgent` until a halt condition     |
| `Sequence`     | Wrapper that chains multi‑stage flows                    |

Memory is plain JSON. Tools may patch it by returning
`{ memPatch(state)‐>newState }`.

## Multi‑stage workflows

```ts
const seq1 = new Sequence(ctxStage1, state1, { maxSteps: 8 });
const { final, history } = await runWorkflow(seq1);
```

Each stage may produce a fresh context and state; user input handling can be
preserved across stages.

## MCP integration (client & server)

NanoAgent ships a tiny **MCP server** helper (`serveMCP`) and an **MCP
client** (`MCPClient`). Your tools can therefore live **outside** the agent
process—behind an HTTP endpoint—yet feel local.

### Why MCP?

- **RAG anywhere** – retrieval can run on an edge function, a GPU pod, or a
  browser worker.
- **Horizontal scaling** – tools are stateless HTTP handlers; use normal
  infra.
- **Polyglot** – heavy lifting in Go, Python or Rust without bloating the TS
  runtime.

### Running a server

```ts
import { ToolRegistry, serveMCP, tool, content } from "@hbbio/nanoagent";

const tools = {
  echo: tool(
    "echo",
    "Echo input back",
    {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    async ({ text }) => content(`Echo: ${text}`),
  ),
};

serveMCP(new ToolRegistry(tools), 3123); // → http://localhost:3123/v1/…
```

### Calling remote tools from an agent

```ts
import { MCPClient, ToolRegistry } from "@hbbio/nanoagent";

const mcp = new MCPClient("http://localhost:3123");
const echoT = await mcp.registeredTool("echo");

const ctx = {
  registry: new ToolRegistry({ echoT }),
  /* … other AgentContext props … */
};
```

`MCPClient` provides the following features:

- `listTools()`: Discover server capabilities (with a default 5‑minute cache)
- `tool(name)`: Fetch a single tool
- `callTool(name, input, memory?)`: Plain HTTP tool call
- `registeredTool(name)`: Wrap a remote tool so agents can call it seamlessly

## Installation

```bash
bun add nanoagent   # or:  npm i nanoagent  pnpm add nanoagent  yarn add nanoagent
```

The package is published as **ES 2020 modules with type‑definitions
included**.

## Using OpenAI or Ollama

### OpenAI

```bash
export CHATGPT_KEY=...
```

And then create instances with:

```ts
import { ChatModel, ChatGPT4o } from "@hbbio/nanoagent";
const model = new ChatModel(ChatGPT4o);
```

or one of the predefined model names. Call any present or future model using
`chatgpt("name")`.

### Ollama

By default Ollama host is `http://localhost:11434`, but you can optionally
define another host:

```bash
export OLLAMA_HOST=...
```

Then run any model, such as:

```ts
import { ChatModel, MistralSmall } from "@hbbio/nanoagent";
const model = new ChatModel(MistralSmall);
```

## Debugging

Pass `{ debug: true }` to `stepAgent`, `loopAgent` or `Sequence`. You will
see:

```
STEP id=- msgs=3 last=assistant halted=-
💬 { role: "assistant", … }
💾 memory keys []
```

Provide your own logger via `options.logger`.

## Contributing and License

Contributions are welcome: Make sure that all tests pass and that coverage
includes your new code and feel free to submit PRs.

Please follow the [coding guidelines](./CODING_GUIDELINES.md) and keep the
project free of extra dependencies.

Written by Henri Binsztok and released under the MIT license.
