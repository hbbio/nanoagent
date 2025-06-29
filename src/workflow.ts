/**
 * Lightweight, purely‑functional agent runtime for NanoAgent.
 *
 * Exports
 * -------
 * • {@link HaltStatus} – discriminated union explaining why the loop stopped.
 * • {@link AgentState} – immutable snapshot travelling between steps.
 * • {@link SequenceOptions} – knobs for debugging and step limits.
 * • {@link AgentContext} – behaviour contract (pure hooks).
 * • {@link stepAgent} – single deterministic transition.
 * • {@link loopAgent} – iterative driver until halted.
 * • {@link Sequence} – convenience wrapper for multi‑stage workflows.
 * • {@link runWorkflow} – high‑level helper chaining sequences.
 */

import { isTextContent } from "./content";
import { stringify } from "./json";
import { type Message, UserMessage } from "./message";
import { ChatModel, Gemma3Small, type Model } from "./model";
import type { ChatMemory, ToolRegistry } from "./tool";
import { requestsUserInput } from "./yes";

/**
 * Enumerates why the agent halted.
 */
export enum HaltKind {
  AwaitUser = "await_user",
  ToolError = "tool_error",
  Done = "done",
  Stopped = "stopped"
}

/**
 * Discriminated halt status, optionally carrying an error.
 */
export type HaltStatus<Err = unknown> =
  | { kind: HaltKind.AwaitUser }
  | { kind: HaltKind.ToolError; error: Err }
  | { kind: HaltKind.Done }
  | { kind: HaltKind.Stopped };

export const awaitUser: HaltStatus<unknown> = { kind: HaltKind.AwaitUser };

/** Immutable state passed between steps. */
export type AgentState<Memory> = {
  /** Optional identifier for debugging/telemetry. */
  readonly id?: string;
  /** Reference to a callable model implementation. */
  readonly model: Model;
  /** Full conversation so far (immutable). */
  readonly messages: readonly Message[];
  /** Opaque functional memory – can be any serialisable structure. */
  readonly memory?: Memory;
  /** Halt condition (undefined when still running). */
  readonly halted?: HaltStatus;
};

/** Config for one sequence run. */
export interface SequenceOptions<Memory extends ChatMemory> {
  /** Maximum number of additional model calls to perform. */
  maxSteps?: number;
  /** When true, the framework prints debug output via `logger`. */
  debug?: boolean;
  /** Preserve previous `getUserInput` callback when chaining sequences. */
  preserveInput?: boolean;
  /** Structured logger – defaults to the global console object. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /** ChatModel used for agent loop management, e.g. does the assistant requires user input */
  yesModel: Model;
  /** Callback on state change */
  onStateChange?: (state: AgentState<Memory>) => void;
  onStart?: (state: AgentState<Memory>) => void;
  onStop?: (state: AgentState<Memory>) => void;
}

/**
 * Agent behaviour contract.  All functions *must* be side‑effect‑free except
 * for `getUserInput`, which is allowed to perform I/O.
 */
export interface AgentContext<Memory extends ChatMemory> {
  /** Context name used only for logging / debugging. */
  name?: string;
  /**
   * System guidelines generator.  Should embed the main instruction payload.
   * It is *not* automatically inserted into the transcript; callers are
   * expected to do so when composing the initial state.
   */
  guidelines?: (memory: Memory) => Promise<string>;
  /** Optional function to request user input when the agents needs user input. */
  getUserInput?: (
    ctx: AgentContext<Memory>,
    state: AgentState<Memory>
  ) => Promise<string>;
  /** Test whether the agent has reached its goal. */
  isFinal: (state: AgentState<Memory>) => Promise<boolean>;
  /** Optional registry of callable tools. */
  registry?: ToolRegistry<Memory>;
  /**
   * Callback to compute the *next* sequence in a multi‑stage workflow.
   * Returning `undefined` ends the workflow after the current sequence.
   */
  nextSequence?: (state: AgentState<Memory>) => Promise<{
    ctx: AgentContext<Memory>;
    state: AgentState<Memory>;
    options?: SequenceOptions<Memory>;
  }>;
  /**
   * Recovery hook invoked when the loop detects that progress has stalled.
   * Implementations typically append a SystemMessage to re‑orient the agent.
   */
  controller?: (state: AgentState<Memory>) => Promise<AgentState<Memory>>;
}

const isToolMessage = (msg?: Message) =>
  msg?.role === "tool" || msg?.role === "function";
const isAssistantMessage = (msg?: Message) => msg?.role === "assistant";
const isEmptyAssistantMessage = (msg?: Message) =>
  isAssistantMessage(msg) &&
  (!msg?.content ||
    (isTextContent(msg.content) && msg.content.text.trim() === ""));
const hasTwoAssistantInRow = (messages: readonly Message[]) =>
  messages.length > 1 &&
  isAssistantMessage(messages[messages.length - 1]) &&
  isAssistantMessage(messages[messages.length - 2]);

/** Options accepted by `stepAgent`. */
export interface StepOptions {
  debug?: boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
  yesModel: Model;
}

/**
 * Advance the agent by one step (model call ± tools ± controller).
 */
export const stepAgent = async <Memory extends ChatMemory>(
  ctx: AgentContext<Memory>,
  state: AgentState<Memory>,
  options: StepOptions
): Promise<AgentState<Memory>> => {
  const log = options.logger?.log ?? console.log;
  const requestsInput = requestsUserInput(options.yesModel);

  // Debug logging
  if (options.debug) {
    const last = state.messages[state.messages.length - 1];
    log(
      `STEP id=${state.id ?? "-"} msgs=${state.messages.length} last=${last?.role} halted=${state.halted?.kind ?? "-"}`
    );
    for (const m of state.messages.slice(1)) log("💬", stringify(m));
    if (state.memory && typeof state.memory === "object")
      log(
        "💾 memory keys",
        Object.keys(state.memory as Record<string, unknown>)
      );
  }

  // Handle already halted
  if (state.halted) {
    switch (state.halted.kind) {
      case HaltKind.AwaitUser: {
        if (!ctx.getUserInput)
          throw new Error("No getUserInput handler provided.");
        const content = await ctx.getUserInput(ctx, state);
        return {
          ...state,
          messages: [...state.messages, UserMessage(content)],
          halted: undefined
        };
      }
      case HaltKind.ToolError: {
        return ctx.controller ? ctx.controller(state) : state;
      }
      case HaltKind.Done:
      case HaltKind.Stopped:
        return state;
    }
  }

  // Model (and tool) call
  let output: { messages: readonly Message[]; memory?: Memory };
  try {
    output = await state.model.complete(state.messages, {
      memory: state.memory,
      tools: ctx.registry?.tools
    });
  } catch (error) {
    const halted: AgentState<Memory> = {
      ...state,
      halted: { kind: HaltKind.ToolError, error }
    };
    return ctx.controller ? ctx.controller(halted) : halted;
  }

  const messages = output.messages;
  const last = messages[messages.length - 1];
  const newState: AgentState<Memory> = {
    ...state,
    messages,
    memory: output.memory
  };

  // Stuck detection: no new msgs OR empty/duplicate assistant
  const msgsUnchanged = messages.length === state.messages.length;
  const emptyAssistant = isEmptyAssistantMessage(last);
  const twoAssistant = hasTwoAssistantInRow(messages);
  const isStuck =
    msgsUnchanged ||
    (isAssistantMessage(last) && (emptyAssistant || twoAssistant));
  if (ctx.controller && isStuck) {
    return ctx.controller(newState);
  }

  // Tool message: just update state, don't finalize
  if (isToolMessage(last)) {
    return newState;
  }

  // Needs user input?
  if (last?.content && (await requestsInput(last.content))) {
    return { ...newState, halted: awaitUser };
  }

  // Final goal reached (only on assistant responses)
  if (isAssistantMessage(last) && (await ctx.isFinal(newState))) {
    return { ...newState, halted: { kind: HaltKind.Done } };
  }

  // Continue running
  return newState;
};

/**
 * Repeatedly invoke `stepAgent` until the agent stops or step budget is
 * exhausted.  Converted from recursion to a `while` loop to avoid call‑stack
 * growth in long‑running sessions.
 */
export const loopAgent = async <Memory extends ChatMemory>(
  ctx: AgentContext<Memory>,
  initState: AgentState<Memory>,
  options: SequenceOptions<Memory> = { yesModel: new ChatModel(Gemma3Small) }
): Promise<AgentState<Memory>> => {
  const logger = options.logger ?? console;
  let state = initState;
  let remaining = options.maxSteps ?? Number.POSITIVE_INFINITY;

  while (true) {
    if (options?.onStateChange) options.onStateChange(state);
    if (
      state.halted?.kind === HaltKind.Done ||
      state.halted?.kind === HaltKind.Stopped
    ) {
      return state;
    }
    if (remaining === 0) {
      return { ...state, halted: { kind: HaltKind.Stopped } };
    }
    if (options?.onStart) options.onStart(state);
    state = await stepAgent(ctx, state, {
      debug: options.debug,
      logger,
      yesModel: options.yesModel
    });
    if (options?.onStop) options.onStop(state);
    remaining =
      remaining === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : remaining - 1;
  }
};

/** Encapsulates a single sequence of agent steps. */
export class Sequence<Memory extends ChatMemory> {
  private _ctx: AgentContext<Memory>;
  private _state: AgentState<Memory>;
  private _options: SequenceOptions<Memory>;
  private _logger: Pick<Console, "log" | "warn" | "error">;

  constructor(
    ctx: AgentContext<Memory>,
    state: AgentState<Memory>,
    options: SequenceOptions<Memory> = { yesModel: new ChatModel(Gemma3Small) }
  ) {
    this._ctx = ctx;
    this._state = state;
    this._options = options;
    this._logger = options.logger ?? console;
  }

  get messages() {
    return this._state.messages;
  }

  /** Replace the underlying state (e.g., after external persistence). */
  resetState = (state: AgentState<Memory>): void => {
    this._state = state;
  };

  /** Politely ask the model to stop streaming (awaits completion). */
  stop = async (): Promise<void> => {
    await this._state.model.stop();
  };

  /** Snapshot current options. */
  private get options(): SequenceOptions<Memory> {
    return this._options;
  }

  /** Run until this sequence yields `halted.kind === 'done' | 'stopped'`. */
  run = (): Promise<AgentState<Memory>> =>
    loopAgent(this._ctx, this._state, this.options);

  /**
   * Execute the sequence once and return the *next* sequence (may be itself).
   */
  async next(): Promise<[Sequence<Memory>, AgentState<Memory>]> {
    const terminal = await this.run();

    if (terminal.halted?.kind === HaltKind.Done && this._ctx.nextSequence) {
      const {
        ctx: nextCtx,
        state: nextState,
        options: nextOpts
      } = await this._ctx.nextSequence(terminal);
      const preserved = nextOpts?.preserveInput
        ? this._ctx.getUserInput
        : undefined;
      if (this.options.debug)
        this._logger.log(
          `⏩ ${this._ctx.name} -> ${nextCtx.name} (preserved: ${preserved})`
        );
      const mergedCtx: AgentContext<Memory> = {
        ...nextCtx,
        getUserInput: nextCtx.getUserInput ?? preserved
      };
      // @todo preserve yesModel?
      const mergedOpts: SequenceOptions<Memory> = {
        ...this.options,
        ...nextOpts
      };

      if (this.options.debug)
        this._logger.log(`☎︎  Sequence → ${nextState.id ?? "-"}`);
      return [new Sequence(mergedCtx, nextState, mergedOpts), terminal];
    }

    if (this.options.debug)
      this._logger.log(`🛑 Sequence ${terminal.id ?? "-"}`);
    return [this, terminal];
  }
}

export type WorkflowOptions<Memory extends ChatMemory> = {
  onSequenceChange?: (seq: Sequence<Memory>) => void;
};

/**
 * Execute a workflow composed of chained `Sequence` objects until no new
 * sequence is produced.  Returns both the final `AgentState` and the ordered
 * history of sequences for inspection / debugging.
 */
export const runWorkflow = async <Memory extends ChatMemory>(
  init: Sequence<Memory>,
  options?: WorkflowOptions<Memory>
): Promise<{ final: AgentState<Memory>; history: Sequence<Memory>[] }> => {
  const history: Sequence<Memory>[] = [];
  let current = init;

  while (true) {
    history.push(current);
    const [next, state] = await current.next();
    current.resetState(state);

    if (options?.onSequenceChange) options.onSequenceChange(current);

    if (next === current) return { final: state, history };
    current = next;
  }
};
