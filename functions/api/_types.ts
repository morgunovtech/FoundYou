export interface PagesEventContext<Env = unknown> {
  request: Request;
  env: Env;
  params: Record<string, string>;
  /**
   * Cloudflare keeps the isolate alive until the promise settles (used for
   * background cache writes). The Vite dev proxy passes a no-op shim.
   */
  waitUntil?(promise: Promise<unknown>): void;
}
