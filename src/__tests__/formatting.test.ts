import { describe, expect, it } from 'vitest';
import { formatHandlebars } from '../formatting.js';

describe('formatHandlebars', () => {
  it('indents content inside a block', () => {
    const input = '{{#if condition}}\ncontent\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe('{{#if condition}}\n  content\n{{/if}}');
  });

  it('returns unchanged text when already formatted', () => {
    const input = '{{#if condition}}\n  content\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe(input);
  });

  it('handles nested blocks', () => {
    const input = '{{#if a}}\n{{#each items}}\nitem\n{{/each}}\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe(
      '{{#if a}}\n  {{#each items}}\n    item\n  {{/each}}\n{{/if}}',
    );
  });

  it('handles else blocks', () => {
    const input = '{{#if condition}}\nyes\n{{else}}\nno\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe('{{#if condition}}\n  yes\n{{else}}\n  no\n{{/if}}');
  });

  it('preserves empty lines', () => {
    const input = '{{#if condition}}\n\ncontent\n\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe('{{#if condition}}\n\n  content\n\n{{/if}}');
  });

  it('uses custom indent size', () => {
    const input = '{{#if condition}}\ncontent\n{{/if}}';
    const result = formatHandlebars(input, 4);
    expect(result).toBe('{{#if condition}}\n    content\n{{/if}}');
  });

  it('returns plain text unchanged', () => {
    const input = 'Hello world';
    const result = formatHandlebars(input, 2);
    expect(result).toBe('Hello world');
  });

  it('handles empty input', () => {
    const result = formatHandlebars('', 2);
    expect(result).toBe('');
  });

  it('strips existing indentation and reindents', () => {
    const input = '{{#if condition}}\n      badly indented\n{{/if}}';
    const result = formatHandlebars(input, 2);
    expect(result).toBe('{{#if condition}}\n  badly indented\n{{/if}}');
  });

  it('preserves block helpers inside component properties', () => {
    const input = '<X @y={{#if foo}}A{{else if bar}}B{{else}}C{{/if}} />';
    const result = formatHandlebars(input, 2);
    expect(result).toBe(input);
  });
});
