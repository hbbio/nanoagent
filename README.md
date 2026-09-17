<p align="center">
  <img src="./logo.png" alt="NanoAgent Logo" width="150" />
</p>

# NanoAgent

**NanoAgent** is a micro‑framework (≈ 1 kLOC) for running LLM‑powered agents
in pure TypeScript **with zero runtime dependencies** outside of
[bun](https://bun.sh). You only need your favorite chat models: OpenAI,
OpenRouter, or a local engine like Ollama.

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
  Qwen35Small,
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
  model: new ChatModel(Qwen35Small),
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

## Using OpenAI, OpenRouter, Ollama or LM Studio

Presets were checked against the provider catalogs on **September 17, 2026**.
`new ChatModel()` defaults to Qwen 3.5 4B; agent control checks default to
Gemma 4 E2B. Existing versioned exports such as `Qwen3Small`, `Gemma3Small`,
`Llama32`, and `ChatGPT41` retain their original model IDs.

| Provider | Preset | Model ID |
| --- | --- | --- |
| OpenAI | `ChatGPT6Astra` | `gpt-6-astra` (Responses API) |
| OpenAI | `ChatGPT56Sol` | `gpt-5.6-sol` |
| OpenAI | `ChatGPT56Terra` | `gpt-5.6-terra` |
| OpenAI | `ChatGPT56Luna` | `gpt-5.6-luna` |
| Ollama | `Qwen35Tiny`, `Qwen35TinyThink` | `qwen3.5:0.8b` |
| Ollama | `Qwen35Small` | `qwen3.5:4b` |
| Ollama | `Qwen38Mid` | `qwen3.8:27b` |
| Ollama | `Gemma4Small` | `gemma4:e2b` |
| Ollama | `Gemma4Mid` | `gemma4:26b` |
| Ollama | `Llama4Scout` | `llama4:16x17b` |
| Ollama | `Llama4Maverick` | `llama4:128x17b` |
| Ollama | `Devstral`, `DevstralSmall2` | `devstral-small-2:24b` |
| Ollama | `Devstral2` | `devstral-2:123b` |
| Ollama | `MistralSmall` | `mistral-small3.2:24b` |
| LM Studio | `Qwen38MidMLX` | `qwen3.8-27b-mlx` (custom load identifier) |
| OpenRouter | `Nemotron3UltraFree` | `nvidia/nemotron-3-ultra-550b-a55b:free` |

Sources: [OpenAI model catalog](https://developers.openai.com/api/docs/models/all),
[Ollama library](https://ollama.com/library),
[LM Studio Qwen3.8](https://lmstudio.ai/models/qwen3.8), and
[OpenRouter Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free).
Qwen 3.5 is still the current small-size generation; Qwen 3.8 is 27B.
Mistral Small 3.2 is the latest Small model verified in Ollama's official
library, so its preset stays on that release.

### OpenAI

```bash
export CHATGPT_KEY=...
```

And then create instances with:

```ts
import { ChatModel, ChatGPT6Astra } from "@hbbio/nanoagent";
const model = new ChatModel(ChatGPT6Astra);
```

or one of the predefined model names. Call any present or future model using
`chatgpt("name")`.

GPT-6 Astra uses the [Responses API for tool calling](https://developers.openai.com/api/docs/guides/latest-model).
`ChatGPT6Astra` and `chatgpt("gpt-6-astra")` select that endpoint automatically.
The existing `complete` and agent APIs work the same way. Responses output,
including encrypted reasoning and message phases, is retained in the
transcript's `responseOutput` field and replayed on later calls with
`store: false`; keep that field when persisting a conversation.

Configure reasoning effort instead of sampling parameters for Astra:

```ts
import { ChatModel, chatgpt } from "@hbbio/nanoagent";

const model = new ChatModel(chatgpt("gpt-6-astra", {
  reasoningEffort: "low",
}));
```

Astra rejects `temperature` and `top_p`. The Responses adapter supports
non-streaming JSON requests; `customResponse` remains a Chat Completions
option. GPT-5.6 and the legacy presets use Chat Completions by default;
pass `{ api: "responses" }` to `chatgpt` to opt another supported model in.

### OpenRouter (including free models)

Create an [OpenRouter API key](https://openrouter.ai/settings/keys), then set:

```bash
export OPENROUTER_API_KEY=...
```

Pass an exact model ID, including `:free` for a free variant such as
[NVIDIA Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free):

```ts
import { ChatModel, openrouter, toText, UserMessage } from "@hbbio/nanoagent";

const model = new ChatModel(openrouter("nvidia/nemotron-3-ultra-550b-a55b:free"));
const { messages } = await model.complete([UserMessage("Hello!")]);
console.log(toText(messages.at(-1)?.content));
```

The `Nemotron3UltraFree` preset is also available:
`new ChatModel(Nemotron3UltraFree)`. Like the other presets, it reads its key at
module import; `openrouter(name)` reads the environment when called.

Pass an exact OpenRouter model ID to select a particular model, including
an available `:free` variant: `openrouter("provider/model:free")`. Use an
ID from the [current free-model catalog](https://openrouter.ai/models?max_price=0);
`provider/model:free` is a placeholder, and not every model has a free
variant. Paid model IDs work with the same helper.

You can also pass an explicit key, temperature, or optional app attribution:

```ts
const model = new ChatModel(openrouter("nvidia/nemotron-3-ultra-550b-a55b:free", {
  key: process.env.OPENROUTER_API_KEY,
  temperature: 0.5,
  headers: {
    "HTTP-Referer": "https://your-app.example",
    "X-OpenRouter-Title": "My agent",
  },
}));
```

Tool calls work through the existing `tools` option and agent workflows.
Pass the tool registry on each `complete` call, including turns containing
tool results. Nemotron 3 Ultra supports tool calling; when selecting another
model, check its tool-calling support.

For `loopAgent` or `Sequence`, also set `options.yesModel` to an OpenRouter
`ChatModel` to run the loop's control checks remotely; its default uses
Ollama.

Free models still require an API key and are subject to availability and
[rate limits](https://openrouter.ai/docs/api/reference/limits). NanoAgent
surfaces API errors without automatically switching to a paid model.

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

Pull the models before running the default agent configuration:

```bash
ollama pull qwen3.5:4b
ollama pull gemma4:e2b
```

Current Qwen and Gemma presets send `think: false` through Ollama's API;
`Qwen35TinyThink` sends `think: true`. Override it with
`ollama("qwen3.8:27b", { think: true })` when desired.
Use a current Ollama installation. Larger presets need substantially more
memory: Llama 4 Scout and Maverick's default downloads are about 67 GB and
245 GB, respectively; neither is used as a default.

### LM Studio

Download a [Qwen3.8 27B MLX model](https://lmstudio.ai/models/qwen3.8), then
run `lms ls` to find its local model key. Load it with the preset's custom
identifier and start the server:

```bash
lms load <model-key-from-lms-ls> --identifier qwen3.8-27b-mlx
lms server start
```

```ts
import { ChatModel, Qwen38MidMLX, lms } from "@hbbio/nanoagent";

const model = new ChatModel(Qwen38MidMLX);
// Or use the exact identifier exposed by your local server:
const custom = new ChatModel(lms("your-loaded-model-id"));
```

The preset supports the local OpenAI-compatible endpoint at
`http://localhost:1234/v1/chat/completions`. Configure the model's thinking
mode in LM Studio; the preset removes inline `<think>` sections from the
displayed reply and does not append Qwen 3's old prompt directive.

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
