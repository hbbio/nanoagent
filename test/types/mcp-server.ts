/** Compile against the emitted package without the project's Bun declarations. */
import { type MCPServer, serveMCP, ToolRegistry } from "../../dist/index.js";

export async function useServer(server = serveMCP(new ToolRegistry(), 0)) {
  const handle: MCPServer = server;
  const endpoint: URL = handle.url;
  const port: number = handle.port;
  const hostname: string = handle.hostname;
  const protocol: "http" | "https" | null = handle.protocol;
  const development: boolean = handle.development;
  const id: string = handle.id;
  const activeRequests: number = handle.pendingRequests;
  const activeSockets: number = handle.pendingWebSockets;
  handle.unref();
  handle.ref();
  const closed: number = handle.closeIdleConnections();

  const request = new Request(endpoint);
  const address = handle.requestIP(request);
  if (address) {
    const family: "IPv4" | "IPv6" = address.family;
    const ip: string = address.address;
    const clientPort: number = address.port;
    void [family, ip, clientPort];
  }
  handle.timeout(request, 30);
  const response: Response = await handle.fetch(request);
  await handle.fetch(endpoint.href);
  const upgraded: boolean = handle.upgrade(request, {
    headers: { "X-Test": "yes" },
    data: { user: "test" }
  });
  handle.upgrade(request);
  handle.upgrade(request, {
    headers: { "Set-Cookie": ["first=1", "second=2"] }
  });
  const sent: number = handle.publish("events", "hello", true);
  handle.publish("events", new Uint8Array([1, 2]));
  handle.publish("events", new SharedArrayBuffer(2));
  handle.publish("events", new Blob(["hello"]));
  const subscribers: number = handle.subscriberCount("events");

  const reloaded: MCPServer = handle.reload({
    fetch(request, current) {
      current.timeout(request, 5);
      return new Response(this.url.href);
    },
    error(error) {
      return new Response(error.message, { status: 500 });
    },
    routes: {
      "/tools/:name": {
        GET(request) {
          const name: string = request.params.name;
          return new Response(name);
        }
      },
      "/ping": new Response("pong")
    }
  });

  handle.reload<{ user: string }>({
    websocket: {
      open(socket) {
        const user: string = socket.data.user;
        socket.subscribe("events");
        socket.sendText(user);
        socket.cork((current) => current.publish("events", user));
      },
      message(socket, message) {
        socket.send(message);
      }
    }
  });

  // Native Bun options can carry additional request APIs from consumer types.
  const nativeOptions = {
    routes: {
      "/cookie": (
        request: Request & {
          cookies: { get(name: string): string | undefined };
        }
      ) => new Response(request.cookies.get("session"))
    }
  };
  handle.reload(nativeOptions);

  // @ts-expect-error Metrics must stay numeric, rather than becoming any.
  const invalidMetric: string = handle.pendingRequests;
  // @ts-expect-error Unknown methods must not be accepted.
  handle.nonexistent();
  // @ts-expect-error The server URL is read-only.
  handle.url = endpoint;

  const stopped: Promise<void> = handle.stop(true);
  handle[Symbol.dispose]();
  void [
    port,
    hostname,
    protocol,
    development,
    id,
    activeRequests,
    activeSockets,
    closed,
    response,
    upgraded,
    sent,
    subscribers,
    reloaded,
    invalidMetric
  ];
  await stopped;
}
