export interface PagesEventContext<Env = unknown> {
  request: Request;
  env: Env;
  /** Route parameters; a `[[name]]` catch-all segment arrives as an array of path parts. */
  params: Record<string, string | string[]>;
  /**
   * Cloudflare keeps the isolate alive until the promise settles (used for
   * background cache writes). The Vite dev proxy passes a no-op shim.
   */
  waitUntil?(promise: Promise<unknown>): void;
}
