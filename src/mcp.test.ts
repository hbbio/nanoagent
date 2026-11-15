import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { MCPClient } from "./mcpClient";
import { serveMCP } from "./mcpServer";
import type { MCPServer } from "./server";
import { content, ToolRegistry, tool } from "./tool";

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
let server: MCPServer;
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

  it("retains the native server handle and can reload request handlers", async () => {
    const handle = serveMCP(registry, 0);
    try {
      const endpoint: URL = handle.url;
      const activeRequests: number = handle.pendingRequests;
      expect(Number(endpoint.port)).toBe(handle.port);
      expect(activeRequests).toBe(0);
      expect(handle.pendingWebSockets).toBe(0);
      handle.unref();
      handle.ref();

      const reloaded = handle.reload({
        fetch(request, current) {
          current.timeout(request, 5);
          return Response.json({
            path: new URL(request.url).pathname,
            activeRequests: current.pendingRequests,
            client: current.requestIP(request)?.address
          });
        }
      });
      expect(reloaded).toBe(handle);
      const response = await fetch(new URL("/reloaded", endpoint));
      expect(await response.json()).toMatchObject({
        path: "/reloaded",
        activeRequests: 1,
        client: expect.any(String)
      });
      expect(typeof handle.closeIdleConnections()).toBe("number");
    } finally {
      await handle.stop(true);
    }
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
