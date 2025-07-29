/**
 * @module tool
 *
 * Tool metadata, helper factories, and registry implementation for NanoAgent.
 * All public exports are documented individually; this header provides a quick
 * overview for the generated docs portal.
 *
 * ### Key Concepts
 * - **Tool**: JSON‑Schema description of a callable function.
 * - **ToolHandler**: async function invoked by the framework.
 * - **ToolCallResponse**: MCP‑style response object.
 * - **ToolRegistry**: in‑memory container that resolves & executes tools.
 */

import { type Content, toContent } from "./content";
import type { JSONSchemaObject, TypedSchema } from "./schema";

/** OpenAI‑style JSON schema describing a callable tool. */
export type Tool = {
  type: "function";
  function: {
    /** Unique, kebab‑case identifier */
    name: string;
    /** Short human description shown to LLM */
    description?: string;
    /** JSON Schema for `arguments` passed to the handler */
    parameters: JSONSchemaObject;
  };
};

/** Opaque, serialisable key‑value bag shared between steps. */
export type ChatMemory = Record<string, unknown>;

/** Pure function that returns a *new* memory snapshot. */
export type ChatMemoryPatch<M extends ChatMemory> = (state: M) => M;

/** MCP extension header fields. */
export const ContentJSON = "x-content";
export const ContentMemoryNonSerializablePatch = "x-memPatch";
/** Reserved key for future extension. */
export const ContentMemoryLambdascriptPatch = "x-memLambda";

/** Response returned by a {@link ToolHandler}. */
export type ToolCallResponse<Memory extends ChatMemory, Out> = {
  /** Preferred rich content payload. */
  content?: readonly Content[];
  /** Error string; *mutually exclusive* with `content`. */
  error?: string;
  /** Structured output for providers lacking `content`. */
  [ContentJSON]?: Out;
  /** Lambdascript program to mutate memory. */
  [ContentMemoryLambdascriptPatch]?: string;
  /** Internal non‑serialisable mutation. */
  [ContentMemoryNonSerializablePatch]?: ChatMemoryPatch<Memory>;
};

/** Optional arguments passed to {@link content}. */
export interface ToolContentOptions<Memory extends ChatMemory> {
  memory?: Memory;
  memPatch?: ChatMemoryPatch<Memory>;
}

/**
 * Build a metadata object carrying memory modifications.
 */
const buildMeta = <Memory extends ChatMemory>({
  memPatch
}: ToolContentOptions<Memory> = {}) => ({
  ...(memPatch ? { [ContentMemoryNonSerializablePatch]: memPatch } : {})
});

/**
 * Helper to return a successful {@link ToolCallResponse}.
 */
export const content = <
  Memory extends ChatMemory,
  Out extends unknown[] | unknown
>(
  value: Out,
  opts?: ToolContentOptions<Memory>
): ToolCallResponse<Memory, Out> => ({
  content: Array.isArray(value) ? value.map(toContent) : [toContent(value)],
  ...buildMeta(opts)
});

/**
 * Helper to return an error {@link ToolCallResponse}.
 */
export const error = (
  v: string | Error
): ToolCallResponse<ChatMemory, never> => ({
  error: v instanceof Error ? v.message : v
});

/** Async function implementing the tool logic. */
export type ToolHandler<
  In = unknown,
  Out = unknown,
  Memory extends ChatMemory = ChatMemory
> = (args: In, memory: Memory) => Promise<ToolCallResponse<Memory, Out>>;

/** Internal tools are trusted, external ones may be over network. */
export const InternalTool = "internal" as const;
export const ExternalTool = "external" as const;
export type ToolType = typeof InternalTool | typeof ExternalTool;

/** Runtime structure combining a {@link Tool} description with its handler. */
export type RegisteredTool<In, Out, Memory extends ChatMemory> = {
  type: ToolType;
  tool: Tool;
  handler: ToolHandler<In, Out, Memory>;
};

/** Registry map; values may be lazy loaders returning a {@link RegisteredTool}. */
export type Tools<Memory extends ChatMemory> = {
  [
    name: string
  ]: // biome-ignore lint/suspicious/noExplicitAny: generic registry
    | RegisteredTool<any, any, Memory>
    // biome-ignore lint/suspicious/noExplicitAny: generic registry
    | (() => Promise<RegisteredTool<any, any, Memory>>);
};

/**
 * Resolve a {@link Tools} map into the static list required by providers.
 */
export const toolList = async <Memory extends ChatMemory>(
  tools: Tools<Memory>
): Promise<readonly Tool[]> =>
  Promise.all(
    Object.entries(tools).map(async ([, v]) =>
      typeof v === "function" ? (await v()).tool : v.tool
    )
  );

/** Factory to register a tool in one expression. */

/**
 * Factory producing a {@link RegisteredTool} in one call.
 */
export const tool = <
  In extends Record<string, unknown>,
  Out,
  Memory extends ChatMemory
>(
  name: string,
  description: string,
  parameters: TypedSchema<In>,
  handler: ToolHandler<In, Out, Memory>,
  type: ToolType = InternalTool
): RegisteredTool<In, Out, Memory> => ({
  type,
  tool: {
    type: "function",
    function: { name, description, parameters }
  },
  handler
});

/**
 * Compose memory patches deterministically; throw if two patches write the same key.
 */
export const composePatches = <M extends ChatMemory>(
  memory: M,
  patches: (ChatMemoryPatch<M> | undefined)[]
): M => {
  let acc = memory;
  const written = new Set<string>();
  for (const patch of patches) {
    if (!patch) continue;
    const beforeKeys = Object.keys(acc);
    acc = patch(acc);
    for (const k of Object.keys(acc)) {
      if (!beforeKeys.includes(k) || acc[k] !== memory[k]) {
        if (written.has(k))
          throw new Error(`Memory‑patch conflict on key '${k}'.`);
        written.add(k);
      }
    }
  }
  return acc;
};

/**
 * Lightweight, in‑memory registry. Holds no global state.
 */
export class ToolRegistry<Memory extends ChatMemory> {
  private readonly _tools: Tools<Memory>;
  constructor(initial: Tools<Memory> = {}) {
    this._tools = initial;
  }

  /** Shallow copy of the tools */
  get tools() {
    return { ...this._tools };
  }

  /** Register or overwrite a tool. */
  add = <In, Out>(reg: RegisteredTool<In, Out, Memory>) => {
    this._tools[reg.tool.function.name] = reg;
  };
  /** Remove a tool from the registry. */
  remove = (name: string) => {
    delete this._tools[name];
  };
  /** List of tool descriptors resolved eagerly. */
  get list() {
    return toolList(this._tools);
  }
  /** Read‑only snapshot of the tool map. */
  get snapshot(): Tools<Memory> {
    return { ...this._tools };
  }

  /**
   * Execute a single tool synchronously and return an augmented response that
   * includes an updated memory snapshot when a patch was produced.
   */
  async call<In, Out>(
    name: string,
    args: In,
    memory: Memory
  ): Promise<ToolCallResponse<Memory, Out>> {
    const entry = this._tools[name];
    if (!entry) throw new Error(`Tool \"${name}\" not found`);
    const { handler } = typeof entry === "function" ? await entry() : entry;
    return handler(args, memory);
  }
}
