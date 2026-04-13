import { describe, expect, it } from 'vitest';
import {
  analyzeBlockStructure,
  analyzeDocument,
  tokenizeHandlebars,
} from '../analysis.js';

describe('tokenizeHandlebars', () => {
  it('returns normalized Handlebars tokens in source order', () => {
    const text =
      '{{!-- note --}}{{#if ready}}{{name}}{{> foo}}{{else}}{{/if}}';
    const tokens = tokenizeHandlebars(text);

    expect(tokens.map((token) => token.type)).toEqual([
      'comment',
      'block-open',
      'mustache',
      'partial',
      'else',
      'block-close',
    ]);

    expect(tokens.map((token) => token.name)).toEqual([
      null,
      'if',
      'name',
      'foo',
      null,
      'if',
    ]);
  });
});

describe('analyzeDocument', () => {
  it('returns Glimmer AST for valid templates', () => {
    const result = analyzeDocument('{{#if ready}}{{name}}{{/if}}');
    expect(result.glimmerAst).not.toBeNull();
    expect(result.parseErrors).toEqual([]);
    expect(result.usedSanitization).toBe(false);
    expect(result.blockAnalysis.issues).toHaveLength(0);
  });

  it('uses sanitization for component/property block helper syntax', () => {
    const result = analyzeDocument(
      '<X @y={{#if foo}}A{{else}}B{{/if}} />',
    );
    expect(result.usedSanitization).toBe(true);
    expect(result.glimmerAst).not.toBeNull();
    expect(result.parseErrors).toEqual([]);
    expect(result.blockAnalysis.issues).toHaveLength(0);
  });

  it('captures parse errors while still returning block analysis', () => {
    const result = analyzeDocument('{{#if ready}}oops');
    expect(result.glimmerAst).toBeNull();
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.parseErrors[0].message.length).toBeGreaterThan(0);
    expect(result.blockAnalysis.issues).toHaveLength(1);
    expect(result.blockAnalysis.issues[0].type).toBe('unclosed-open');
  });
});

describe('analyzeBlockStructure', () => {
  it('handles whitespace control and else if', () => {
    const result = analyzeBlockStructure(
      '{{~#if a~}}yes{{~else if b~}}maybe{{~else~}}no{{~/if~}}',
    );
    expect(result.issues).toHaveLength(0);
    expect(result.openStack).toHaveLength(0);
  });
});
