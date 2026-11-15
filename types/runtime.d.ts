/** The runtime APIs used by NanoAgent; web APIs come from TypeScript's DOM lib. */
declare const process: {
  readonly versions: { readonly node?: string };
  env: Record<string, string | undefined>;
};

/** Use the public server contract for both runtime checks and emitted types. */
declare const Bun: {
  serve(options: {
    port?: number;
    fetch(request: Request): Response | Promise<Response>;
  }): import("../src/server").MCPServer;
};
