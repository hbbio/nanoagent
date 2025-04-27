import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { MCPClient } from "./mcpClient";
import { serveMCP } from "./mcpServer";
import { ToolRegistry, content, tool } from "./tool";

const tools = {
  echo: tool(
    "echo",
    "Echo input",
    {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"]
    },
    async ({ text }) => content(`Echo: ${text}`)
  )
};

const registry = new ToolRegistry(tools);
const port = 3123;
const baseURL = `http://localhost:${port}`;
let server: ReturnType<typeof Bun.serve>;
let client: MCPClient;

describe("MCP Server", () => {
  beforeAll(() => {
    server = serveMCP(registry, port);
    client = new MCPClient(baseURL);
  });
  afterAll(() => {
    if (server) server.stop();
  });

  it("should list tools", async () => {
    const list = await client.listTools();
    expect(list).toBeInstanceOf(Array);
    expect(list.find((t) => t.function.name === "echo")).toBeTruthy();
  });

  it("should call echo tool", async () => {
    const result = await client.callTool("echo", { text: "hello bun" });
    expect(result.content?.[0]).toMatchObject({
      type: "text",
      text: "Echo: hello bun"
    });
  });

  it("should return 500 for unknown tool", async () => {
    const badCall = client.callTool("not_a_tool", {});
    await expect(badCall).rejects.toThrow("Tool call failed");
  });
});
