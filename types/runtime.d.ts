/** The runtime APIs used by NanoAgent; web APIs come from TypeScript's DOM lib. */
declare const process: {
  readonly versions: { readonly node?: string };
  env: Record<string, string | undefined>;
};

/** Keep the server handle structural so emitted declarations need no Bun types. */
declare const Bun: {
  serve(options: {
    port?: number;
    fetch(request: Request): Response | Promise<Response>;
  }): {
    readonly port: number;
    stop(closeActiveConnections?: boolean): Promise<void>;
  };
};
