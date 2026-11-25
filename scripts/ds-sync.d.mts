/** The vendored design system's manifest, `ds.json` at the repo root. */
export interface DsManifest {
  /** Where the files come from, e.g. `https://s.morgunov.tech`. */
  origin: string;
  /** Where the copies live, relative to the repo root, e.g. `public`. */
  root: string;
  /** Path (relative to both) → the first 8 hex characters of the file's SHA-1. */
  files: Record<string, string>;
}

export const CRITICAL_SELECTORS: readonly string[];
export const CRITICAL_PAGES: readonly string[];

/** The first 8 hex characters of the SHA-1 — the origin's `?v=`. */
export function shortHash(bytes: Uint8Array | string): string;

/** selector → one minified line, for the three critical blocks of tokens.css. */
export function criticalLines(tokensCss: string): Record<string, string>;

/** The page with its three critical lines replaced; throws naming the page when a line is missing. */
export function replaceCriticalLines(html: string, lines: Record<string, string>, name?: string): string;

/** One line per difference between the manifest and the tree; empty when in sync. */
export function findings(manifest: DsManifest, read: (relPath: string) => Uint8Array | null): string[];

/** The address `--write` fetches: the file under a query the origin's CDN has not cached. */
export function freshUrl(origin: string, file: string, stamp?: number): string;
