import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CRITICAL_PAGES,
  criticalLines,
  findings,
  replaceCriticalLines,
  shortHash,
  type DsManifest
} from '../../../scripts/ds-sync.mjs';

const TOKENS = `/* header comment { with a brace } */
:root {
  --v4-bg: #edeae5;
  /* a comment between declarations */
  --v4-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --v4-label-tracking: 0.1em;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  [data-theme="auto"] {
    --v4-bg: #14130f;
  }
}

[data-theme="dark"] {
  --v4-bg: #14130f;
  color-scheme: dark;
}

[data-theme="high-contrast"] {
  --v4-bg: #000000;
  color-scheme: dark;
}

@media print {
  :root,
  [data-theme="dark"] {
    --v4-bg: #fff;
  }
}
`;

const PAGE = [
  '<style>',
  '      :root{--v4-bg:#old;--v4-label-tracking:.1em}',
  '      [data-theme="dark"]{--v4-bg:#old}',
  '      [data-theme="high-contrast"]{--v4-bg:#000}',
  '      [data-theme="high-contrast"] body.v4-page{font-size:16px}',
  '</style>'
].join('\n');

function treeOver(files: Record<string, string | Uint8Array>) {
  return (relPath: string): Uint8Array | null => {
    const content = files[relPath];
    if (content === undefined) return null;
    return typeof content === 'string' ? Buffer.from(content) : content;
  };
}

describe('shortHash', () => {
  it('is the first 8 hex characters of the SHA-1, the origin’s ?v=', () => {
    expect(shortHash('abc')).toBe(createHash('sha1').update('abc').digest('hex').slice(0, 8));
    expect(shortHash(Buffer.from('abc'))).toBe(shortHash('abc'));
  });
});

describe('criticalLines', () => {
  it('minifies the three top-level blocks in file order, values as the canon writes them', () => {
    expect(criticalLines(TOKENS)).toEqual({
      ':root':
        ':root{--v4-bg:#edeae5;--v4-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;--v4-label-tracking:0.1em;color-scheme:light dark}',
      '[data-theme="dark"]': '[data-theme="dark"]{--v4-bg:#14130f;color-scheme:dark}',
      '[data-theme="high-contrast"]': '[data-theme="high-contrast"]{--v4-bg:#000000;color-scheme:dark}'
    });
  });

  it('skips the @media copies and throws when a block is missing', () => {
    expect(criticalLines(TOKENS)[':root']).not.toContain('#fff');
    expect(() => criticalLines(':root { --v4-bg: #fff; }')).toThrow(/\[data-theme="dark"\]/);
  });
});

describe('replaceCriticalLines', () => {
  it('replaces the three lines, keeps the indentation and the other critical rules', () => {
    const next = replaceCriticalLines(PAGE, criticalLines(TOKENS), 'index.html');
    expect(next).toContain(
      '\n      :root{--v4-bg:#edeae5;--v4-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;--v4-label-tracking:0.1em;color-scheme:light dark}\n'
    );
    expect(next).toContain('\n      [data-theme="high-contrast"]{--v4-bg:#000000;color-scheme:dark}\n');
    expect(next).toContain('\n      [data-theme="high-contrast"] body.v4-page{font-size:16px}\n');
    expect(next.split('\n')).toHaveLength(PAGE.split('\n').length);
  });

  it('throws naming the page when a line is missing or doubled', () => {
    const lines = criticalLines(TOKENS);
    expect(() => replaceCriticalLines('<style>\n:root{}\n</style>', lines, '404.html')).toThrow(/404\.html.*dark/);
    expect(() => replaceCriticalLines(`${PAGE}\n:root{}`, lines, 'index.html')).toThrow(/found 2/);
  });
});

describe('findings', () => {
  const manifest: DsManifest = {
    origin: 'https://example.test',
    root: 'public',
    files: { 'ds/v1/tokens.css': shortHash(TOKENS), 'fonts/a.woff2': shortHash('font-bytes') }
  };
  const synced = {
    'public/ds/v1/tokens.css': TOKENS,
    'public/fonts/a.woff2': 'font-bytes',
    'index.html': replaceCriticalLines(PAGE, criticalLines(TOKENS)),
    '404.html': replaceCriticalLines(PAGE, criticalLines(TOKENS))
  };

  it('is empty when every copy hashes as the manifest says and the critical lines match', () => {
    expect(CRITICAL_PAGES).toEqual(['index.html', '404.html']);
    expect(findings(manifest, treeOver(synced))).toEqual([]);
  });

  it('names a changed copy with both hashes, a missing one, and a stale critical line', () => {
    const out = findings(manifest, treeOver({ ...synced, 'public/fonts/a.woff2': 'other', '404.html': PAGE }));
    expect(out).toEqual([
      `fonts/a.woff2: manifest ${shortHash('font-bytes')}, file ${shortHash('other')} (run --write, or fix the manifest)`,
      '404.html: the critical :root line differs from ds/v1/tokens.css (run --write)',
      '404.html: the critical [data-theme="dark"] line differs from ds/v1/tokens.css (run --write)',
      '404.html: the critical [data-theme="high-contrast"] line differs from ds/v1/tokens.css (run --write)'
    ]);
    expect(findings(manifest, treeOver({ ...synced, 'public/fonts/a.woff2': undefined as never }))).toContain(
      'fonts/a.woff2: missing under public/ (run --write)'
    );
  });
});
