import { describe, expect, it } from 'vitest';
import { fileUriToPath, readTokenAt, uniqueStrings } from '../utilities.js';

describe('uniqueStrings', () => {
  it('removes duplicates', () => {
    expect(uniqueStrings(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty and whitespace strings', () => {
    expect(uniqueStrings(['a', '', '  ', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', () => {
    expect(uniqueStrings([])).toEqual([]);
  });

  it('preserves order of first occurrence', () => {
    expect(uniqueStrings(['c', 'a', 'b', 'a'])).toEqual(['c', 'a', 'b']);
  });
});

describe('fileUriToPath', () => {
  it('converts file URI to path', () => {
    const result = fileUriToPath('file:///tmp/file.hbs');
    expect(result).toBe('/tmp/file.hbs');
  });

  it('returns null for non-file URIs', () => {
    expect(fileUriToPath('https://example.com')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(fileUriToPath('')).toBeNull();
  });

  it('converts file:// with no path to root', () => {
    expect(fileUriToPath('file://')).toBe('/');
  });
});

describe('readTokenAt', () => {
  it('reads a simple token', () => {
    expect(readTokenAt('{{name}}', 3)).toBe('name');
  });

  it('reads a dotted path', () => {
    expect(readTokenAt('{{person.name}}', 5)).toBe('person.name');
  });

  it('returns null for non-token characters', () => {
    expect(readTokenAt('{{ }}', 2)).toBeNull();
  });

  it('reads token at start of string', () => {
    expect(readTokenAt('name', 0)).toBe('name');
  });

  it('reads token at end of string', () => {
    expect(readTokenAt('name', 3)).toBe('name');
  });

  it('handles slashes in paths', () => {
    expect(readTokenAt('{{x/foo}}', 5)).toBe('x/foo');
  });
});
