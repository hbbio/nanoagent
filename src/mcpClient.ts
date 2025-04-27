import type {
  ChatMemory,
  RegisteredTool,
  Tool,
  ToolCallResponse
} from "./tool";

/**
 * MCPClient is a client to a given MCP server.
 */
export class MCPClient {
  private _cache: Promise<Tool[]> | null = null;
  private _timestamp = 0;
  private readonly _duration = 5 * 60 * 1000; // 5 minutes

  constructor(public baseURL: string) {}

  private async _fetchTools(): Promise<Tool[]> {
    const res = await fetch(`${this.baseURL}/v1/tools`);
    if (!res.ok) throw new Error(`Failed to list tools: ${res.status}`);
    return res.json() as Promise<Tool[]>;
  }

  /**
   * listTools returns the list of tools for the MCP server.
   * By default, results are cached for 5 minutes.
   */
  async listTools(): Promise<Tool[]> {
    const now = Date.now();

    if (!this._cache || now - this._timestamp > this._duration) {
      this._timestamp = now;
      this._cache = this._fetchTools();
    }

    return this._cache;
  }

  tool = async (name: string) => {
    const all = await this.listTools();
    return all.find((tool) => tool.function.name === name);
  };

  // @todo check the response type is matching
  async callTool(
    name: string,
    input: unknown,
    memory: Record<string, unknown> = {}
  ): Promise<ToolCallResponse<ChatMemory, unknown>> {
    const res = await fetch(`${this.baseURL}/v1/tool-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, input, memory })
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        `Tool call failed: ${res.status} - ${err?.error || "Unknown error"}`
      );
    }
    return res.json() as Promise<ToolCallResponse<ChatMemory, unknown>>;
  }

  /**
   * registeredTool creates an external registered tool that can be
   * added to workflows.
   */
  registeredTool = async <In, Out, Memory extends ChatMemory>(
    name: string
  ): Promise<RegisteredTool<In, Out, Memory>> => {
    const tool = await this.tool(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    // @todo memory unused for MCP
    const handler = (args: In, _memory: Memory) =>
      this.callTool(name, args, {} as Memory);
    return {
      type: "external",
      tool,
      handler
    } as RegisteredTool<In, Out, Memory>;
  };
}
