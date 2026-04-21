import { describe, expect, it } from 'vitest';
import { Position } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletions } from '../completions.js';
import { defaultSettings } from '../types.js';

describe('getCompletions', () => {
  it('returns no completions outside Handlebars expressions', () => {
    const document = TextDocument.create(
      'file:///tmp/plain.hbs',
      'handlebars',
      1,
      'Hello world',
    );

    const items = getCompletions(document, Position.create(0, 5), {
      ...defaultSettings,
      helpers: ['sampleHelper'],
      partials: ['samplePartial'],
    });

    expect(items).toEqual([]);
  });

  it('returns completions when a Handlebars expression follows plain text', () => {
    const document = TextDocument.create(
      'file:///tmp/inline.hbs',
      'handlebars',
      1,
      'Hello {{> ',
    );

    const items = getCompletions(document, Position.create(0, 10), {
      ...defaultSettings,
      helpers: ['sampleHelper'],
      partials: ['samplePartial'],
    });

    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining(['{{> partial}}', 'samplePartial']),
    );
  });

  it('prefers inline partial completion metadata over helper metadata on name collisions', () => {
    const document = TextDocument.create(
      'file:///tmp/inline-collision.hbs',
      'handlebars',
      1,
      '{{#*inline "sampleHelper"}}x{{/inline}}\n{{> sampleHelper',
    );

    const items = getCompletions(document, Position.create(1, 15), {
      ...defaultSettings,
      helpers: ['sampleHelper'],
      partials: [],
    });
    const item = items.find((candidate) => candidate.label === 'sampleHelper');

    expect(item?.detail).toBe('Inline partial in document');
    expect(item?.kind).toBeDefined();
  });
});
