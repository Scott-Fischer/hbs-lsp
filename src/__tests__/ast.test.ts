import { describe, expect, it } from 'vitest';
import { sanitizeForGlimmer } from '../ast.js';

describe('sanitizeForGlimmer', () => {
  it('returns plain text unchanged', () => {
    expect(sanitizeForGlimmer('Hello world')).toBe('Hello world');
  });

  it('leaves simple mustache expressions intact', () => {
    expect(sanitizeForGlimmer('{{name}}')).toBe('{{name}}');
  });

  it('masks block tokens inside HTML attribute values', () => {
    const input = '<div class="{{#if active}}on{{/if}}">';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if');
    expect(result).not.toContain('{{/if');
    expect(result).toContain('<div');
  });

  it('masks block tokens inside single-quoted HTML attributes', () => {
    const input = "<div class='{{#if active}}on{{/if}}'>";
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if');
  });

  it('masks block tokens inside unquoted HTML tag context', () => {
    const input = '<div {{#if active}}class="on"{{/if}}>';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if');
  });

  it('preserves block tokens outside HTML tags', () => {
    const input = '{{#if condition}}content{{/if}}';
    const result = sanitizeForGlimmer(input);
    expect(result).toBe(input);
  });

  it('handles empty string', () => {
    expect(sanitizeForGlimmer('')).toBe('');
  });

  it('handles else blocks inside HTML attributes', () => {
    const input = '<div class="{{#if a}}x{{else}}y{{/if}}">';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if');
    expect(result).not.toContain('{{else');
    expect(result).not.toContain('{{/if');
  });

  it('masks block helpers inside component/property syntax', () => {
    const input = '<X @y={{#if foo}}A{{else if bar}}B{{else}}C{{/if}} />';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if');
    expect(result).not.toContain('{{else if');
    expect(result).not.toContain('{{else}}');
    expect(result).not.toContain('{{/if');
    expect(result).toContain('<X');
    expect(result).toContain('@y=');
  });

  it('masks nested block helpers inside tag and attribute contexts', () => {
    const input =
      '<div data-x1="{{#if outer}}{{#if inner}}on{{else}}off{{/if}}{{else}}idle{{/if}}"></div>';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{#if outer');
    expect(result).not.toContain('{{#if inner');
    expect(result).not.toContain('{{else}}');
    expect(result).not.toContain('{{/if');
    expect(result).toContain('data-x1="');
  });

  it('masks whitespace-control block helpers inside tag contexts', () => {
    const input =
      '<div {{~#if active~}}class="on"{{~else~}}hidden{{~/if~}}></div>';
    const result = sanitizeForGlimmer(input);
    expect(result).not.toContain('{{~#if');
    expect(result).not.toContain('{{~else~}}');
    expect(result).not.toContain('{{~/if~}}');
  });

  it('handles multiple HTML tags', () => {
    const input = '<span>{{name}}</span><div>{{value}}</div>';
    const result = sanitizeForGlimmer(input);
    expect(result).toContain('{{name}}');
    expect(result).toContain('{{value}}');
  });

  it('handles self-closing tags', () => {
    const input = '<img src="test.png" />';
    const result = sanitizeForGlimmer(input);
    expect(result).toBe(input);
  });
});
