import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stampDsVersions } from '../../build/dsVersionStamp';

const md5Short = (text: string) => createHash('md5').update(Buffer.from(text)).digest('hex').slice(0, 8);

function readerOver(files: Record<string, string>) {
  return (name: string): Buffer => {
    const content = files[name];
    if (content === undefined) throw new Error(`ENOENT: ${name}`);
    return Buffer.from(content);
  };
}

describe('stampDsVersions', () => {
  it('stamps every DS reference with the first 8 hex characters of the file MD5', () => {
    const files = { 'tokens.css': ':root { --v4-fg: #000; }', 'components.css': '.v4-btn { border-radius: 0; }' };
    const html = [
      '<link rel="stylesheet" href="/ds/v1/tokens.css?v=dev">',
      '<link rel="stylesheet" href="/ds/v1/components.css?v=dev">'
    ].join('\n');

    const stamped = stampDsVersions(html, readerOver(files));

    expect(stamped).toContain(`/ds/v1/tokens.css?v=${md5Short(files['tokens.css'])}`);
    expect(stamped).toContain(`/ds/v1/components.css?v=${md5Short(files['components.css'])}`);
    expect(stamped).not.toContain('?v=dev');
  });

  it('throws naming the file when a referenced stylesheet cannot be read', () => {
    const html = '<link rel="stylesheet" href="/ds/v1/missing.css?v=dev">';
    expect(() => stampDsVersions(html, readerOver({}))).toThrow(/missing\.css/);
  });

  it('matches names with hyphens and digits', () => {
    const files = { 'v4-layout2.css': 'body { margin: 0; }' };
    const html = '<link rel="stylesheet" href="/ds/v1/v4-layout2.css?v=dev">';
    expect(stampDsVersions(html, readerOver(files))).toBe(
      `<link rel="stylesheet" href="/ds/v1/v4-layout2.css?v=${md5Short(files['v4-layout2.css'])}">`
    );
  });

  it('leaves unrelated ?v=dev references untouched', () => {
    const html = [
      '<link rel="stylesheet" href="/styles.css?v=dev">',
      '<link rel="stylesheet" href="/ds/v2/tokens.css?v=dev">',
      '<script src="/ds/v1/app.js?v=dev"></script>'
    ].join('\n');
    const reader = (name: string): Buffer => {
      throw new Error(`should not be asked for ${name}`);
    };
    expect(stampDsVersions(html, reader)).toBe(html);
  });

  it('is repeatable: a second call over fresh input stamps again (the global regex holds no state)', () => {
    const files = { 'tokens.css': 'a' };
    const html = '<link href="/ds/v1/tokens.css?v=dev">';
    expect(stampDsVersions(html, readerOver(files))).toBe(stampDsVersions(html, readerOver(files)));
  });
});
