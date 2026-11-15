/**
 * Public structural types for the Bun server returned by `serveMCP`.
 * These are emitted with the package and do not require `@types/bun`.
 * @see https://bun.com/reference/bun/Server
 */
export interface MCPServer extends Disposable {
  readonly port: number;
  readonly hostname: string;
  readonly url: URL;
  readonly protocol: "http" | "https" | null;
  readonly development: boolean;
  readonly id: string;
  readonly pendingRequests: number;
  readonly pendingWebSockets: number;

  stop(closeActiveConnections?: boolean): Promise<void>;
  closeIdleConnections(): number;
  ref(): void;
  unref(): void;
  fetch(request: Request | string): Response | Promise<Response>;
  reload<Data = unknown, Route extends string = string>(
    options: MCPServerReloadOptions<Data, Route>
  ): MCPServer;
  /** Also accept native options types supplied by consumers with Bun declarations. */
  reload(options: object): MCPServer;
  requestIP(request: Request): {
    address: string;
    port: number;
    family: "IPv4" | "IPv6";
  } | null;
  timeout(request: Request, seconds: number): void;
  upgrade<Data = undefined>(
    request: Request,
    options?: {
      headers?:
        | HeadersInit
        | string[][]
        | Record<string, string | readonly string[]>;
      data?: Data;
    }
  ): boolean;
  publish(
    topic: string,
    data: string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView | Blob,
    compress?: boolean
  ): number;
  subscriberCount(topic: string): number;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Bun permits handlers to finish after a WebSocket upgrade without returning a response.
type HandlerResult = Response | void;

type FetchHandler<Req = Request> = (
  this: MCPServer,
  request: Req,
  server: MCPServer
) => HandlerResult | Promise<HandlerResult>;

type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [Key in Param | keyof RouteParams<Rest>]: string }
    : Path extends `${string}:${infer Param}`
      ? { [Key in Param]: string }
      : Record<never, string>;

type RouteHandler<Path extends string> = FetchHandler<
  Request & { params: RouteParams<Path> }
>;

type RouteValue<Path extends string> =
  | Response
  | false
  | RouteHandler<Path>
  | Partial<
      Record<
        | "GET"
        | "HEAD"
        | "POST"
        | "PUT"
        | "DELETE"
        | "PATCH"
        | "OPTIONS"
        | "CONNECT"
        | "TRACE",
        RouteHandler<Path>
      >
    >;

/** Handlers that can be replaced on a running server. */
export interface MCPServerReloadOptions<
  Data = unknown,
  Route extends string = string
> {
  fetch?: FetchHandler;
  error?: (
    this: MCPServer,
    error: Error
  ) => HandlerResult | Promise<HandlerResult>;
  routes?: { [Path in Route]: RouteValue<Path> };
  /** Legacy name for static routes. */
  static?: { [Path in Route]: RouteValue<Path> };
  websocket?: MCPServerWebSocketHandler<Data>;
  /** Bun ignores other initial server options during reload. */
  [option: string]: unknown;
}

type BinaryData = ArrayBufferLike | ArrayBufferView;

/** Server-side WebSocket operations available to reloaded handlers. */
export interface MCPServerWebSocket<Data = unknown> {
  data: Data;
  readonly remoteAddress: string;
  readonly readyState: 0 | 1 | 2 | 3;
  binaryType?: "nodebuffer" | "arraybuffer" | "uint8array";
  send(data: string | BinaryData, compress?: boolean): number;
  sendText(data: string, compress?: boolean): number;
  sendBinary(data: BinaryData, compress?: boolean): number;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data?: string | BinaryData): number;
  pong(data?: string | BinaryData): number;
  publish(topic: string, data: string | BinaryData, compress?: boolean): number;
  publishText(topic: string, data: string, compress?: boolean): number;
  publishBinary(topic: string, data: BinaryData, compress?: boolean): number;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  isSubscribed(topic: string): boolean;
  cork<Result>(callback: (socket: this) => Result): Result;
  getBufferedAmount(): number;
}

/** WebSocket callbacks and settings accepted by `server.reload`. */
export interface MCPServerWebSocketHandler<Data = unknown> {
  open?(socket: MCPServerWebSocket<Data>): void;
  message?(
    socket: MCPServerWebSocket<Data>,
    message: string | Uint8Array
  ): void;
  close?(socket: MCPServerWebSocket<Data>, code: number, reason: string): void;
  drain?(socket: MCPServerWebSocket<Data>): void;
  ping?(socket: MCPServerWebSocket<Data>, data: Uint8Array): void;
  pong?(socket: MCPServerWebSocket<Data>, data: Uint8Array): void;
  error?(error: Error, socket: MCPServerWebSocket<Data>): void;
  maxPayloadLength?: number;
  backpressureLimit?: number;
  closeOnBackpressureLimit?: boolean;
  idleTimeout?: number;
  sendPings?: boolean;
  publishToSelf?: boolean;
  perMessageDeflate?:
    | boolean
    | {
        compress?: boolean | WebSocketCompressor;
        decompress?: boolean | WebSocketCompressor;
      };
}

type WebSocketCompressor =
  | "disable"
  | "shared"
  | "dedicated"
  | "3KB"
  | "4KB"
  | "8KB"
  | "16KB"
  | "32KB"
  | "64KB"
  | "128KB"
  | "256KB";
