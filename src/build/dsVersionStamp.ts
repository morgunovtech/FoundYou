/**
 * The design-system stylesheets live in public/ds/v1 and are linked from index.html with
 * `?v=dev`. At build time the stamp becomes a content hash (the first 8 hex characters of
 * the file's MD5, mirroring the source repo's scripts/version-stamp.py), so a DS update busts
 * the cache while unchanged files keep theirs.
 *
 * Pure: `readFile` is handed in by `vite.config.ts` (bound to the ds dir) so the rewrite can
 * be tested without a filesystem. A reference whose file cannot be read is an error, not a
 * silent `?v=dev` that would ship a stylesheet the browser never revalidates.
 */
import { createHash } from 'node:crypto';

/** One `/ds/v1/<name>.css?v=dev` reference; names may carry digits and hyphens. */
const DS_REFERENCE = /\/ds\/v1\/([a-z0-9-]+)\.css\?v=dev/g;

export function stampDsVersions(html: string, readFile: (name: string) => Buffer): string {
  return html.replace(DS_REFERENCE, (_match, name: string) => {
    const file = `${name}.css`;
    let bytes: Buffer;
    try {
      bytes = readFile(file);
    } catch (error) {
      throw new Error(`ds-version-stamp: index.html links /ds/v1/${file}, which cannot be read`, { cause: error });
    }
    const hash = createHash('md5').update(bytes).digest('hex').slice(0, 8);
    return `/ds/v1/${file}?v=${hash}`;
  });
}
