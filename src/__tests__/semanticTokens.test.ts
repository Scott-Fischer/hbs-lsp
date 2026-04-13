import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  computeSemanticTokens,
  semanticTokensLegend,
} from '../semanticTokens.js';

type DecodedToken = {
  line: number;
  start: number;
  length: number;
  type: string;
  modifiers: string[];
  text: string;
};

function decodeTokens(text: string, data: number[]): DecodedToken[] {
  const lines = text.split(/\r?\n/);
  const tokens: DecodedToken[] = [];
  let line = 0;
  let character = 0;

  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
    const length = data[i + 2];
    const type = semanticTokensLegend.tokenTypes[data[i + 3]];
    const modifierMask = data[i + 4];
    const modifiers = semanticTokensLegend.tokenModifiers.filter(
      (_modifier, index) => (modifierMask & (1 << index)) !== 0,
    );
    const tokenText = lines[line]?.slice(character, character + length) ?? '';
    tokens.push({
      line,
      start: character,
      length,
      type,
      modifiers,
      text: tokenText,
    });
  }

  return tokens;
}

describe('computeSemanticTokens', () => {
  it('does not emit operator tokens for plain HTML characters', () => {
    const text = '<div><span># plain / html ></span></div>';
    const document = TextDocument.create(
      'file:///plain-html.hbs',
      'handlebars',
      1,
      text,
    );
    const result = computeSemanticTokens(document, ['if', 'each', 'with']);
    const decoded = decodeTokens(text, result.data);

    expect(decoded).toHaveLength(0);
  });

  it('emits operator tokens only for Handlebars delimiters and sigils', () => {
    const text = '<div>{{#if ready}}{{> foo}}{{name}}{{/if}}</div>';
    const document = TextDocument.create(
      'file:///tokens.hbs',
      'handlebars',
      1,
      text,
    );
    const result = computeSemanticTokens(document, ['if', 'each', 'with']);
    const decoded = decodeTokens(text, result.data);

    const operators = decoded.filter((token) => token.type === 'operator');
    const operatorTexts = operators.map((token) => token.text);
    expect(operatorTexts).toEqual(
      expect.arrayContaining(['{{', '#', '}}', '>', '/', '{{', '}}']),
    );
    expect(
      operators.some((token) => token.text === '>' && token.start === 4),
    ).toBe(false);
  });

  it('highlights static partial names consistently as function tokens', () => {
    const text = "{{> foo/partials/bar alpha='beta'}}";
    const document = TextDocument.create(
      'file:///partial-tokens.hbs',
      'handlebars',
      1,
      text,
    );
    const result = computeSemanticTokens(document, ['if', 'each', 'with']);
    const decoded = decodeTokens(text, result.data);

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          text: 'foo/partials/bar',
        }),
      ]),
    );
  });

  it('marks inline partial declarations and invocations with local semantic modifiers', () => {
    const text = '{{#*inline "example"}}x{{/inline}}\n{{> example}}';
    const document = TextDocument.create(
      'file:///example-inline-tokens.hbs',
      'handlebars',
      1,
      text,
    );
    const result = computeSemanticTokens(document, ['if', 'each', 'with']);
    const decoded = decodeTokens(text, result.data);

    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          text: 'example',
          modifiers: expect.arrayContaining(['declaration', 'local']),
        }),
        expect.objectContaining({
          type: 'function',
          text: 'example',
          modifiers: expect.arrayContaining(['local']),
        }),
        expect.objectContaining({
          type: 'function',
          text: 'inline',
        }),
      ]),
    );
  });
});
