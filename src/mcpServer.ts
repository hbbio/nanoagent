import type { ChatMemory, ToolRegistry } from "./tool";

// cf. https://bun.sh/docs/api/http
export const serveMCP = <Memory extends ChatMemory>(
  toolRegistry: ToolRegistry<Memory>,
  port = 3000
) => {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/v1/tools") {
        return Response.json(await toolRegistry.list);
      }

      if (req.method === "POST" && url.pathname === "/v1/tool-call") {
        try {
          const body = await req.json();
          const { name, input, memory } = body as {
            name: string;
            input: unknown;
            memory: Memory;
          };
          const result = await toolRegistry.call(name, input, memory);
          return Response.json(result);
        } catch (err) {
          console.error("Error in tool-call:", err);
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      return new Response("Not found", { status: 404 });
    }
  });

  console.log(`📡 MCP server running on http://localhost:${server.port}`);
  return server;
};
