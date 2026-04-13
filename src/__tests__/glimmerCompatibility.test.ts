import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { isKnownGlimmerCompatibilityFalsePositive } from '../glimmerCompatibility.js';
import type { DocumentAnalysis, ParseErrorInfo } from '../types.js';

function makeDocument(text: string): TextDocument {
  return TextDocument.create('file:///compatibility.hbs', 'handlebars', 1, text);
}

function makeAnalysis(
  overrides: Partial<DocumentAnalysis> = {},
): DocumentAnalysis {
  return {
    tokens: [],
    blockAnalysis: { issues: [], openStack: [] },
    glimmerAst: null,
    usedSanitization: false,
    parseErrors: [],
    delimiterDiagnostics: [],
    ...overrides,
  };
}

function makeError(
  message: string,
  location?: ParseErrorInfo['location'],
): ParseErrorInfo {
  return { message, location };
}

describe('isKnownGlimmerCompatibilityFalsePositive', () => {
  it('treats known Glimmer unsupported syntax messages as false positives', () => {
    const document = makeDocument('{{#if ../type}}{{/if}}');
    const analysis = makeAnalysis();
    const error = makeError(
      'Changing context using "../" is not supported in Glimmer',
    );

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(true);
  });

  it('treats sanitization-induced html parse noise as false positives', () => {
    const document = makeDocument(
      '<div {{#if cond}}data-x2="x"{{/if}}></div>',
    );
    const analysis = makeAnalysis({ usedSanitization: true });
    const error = makeError('Unclosed element `div`');

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(true);
  });

  it('treats optional html end tag mismatches as false positives', () => {
    const document = makeDocument('<ul>\n  <li>One\n</ul>');
    const analysis = makeAnalysis();
    const error = makeError(
      'Closing tag </ul> did not match last open tag <li> (on line 2)',
    );

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(true);
  });

  it('treats xml declarations as false positives for raw svg templates', () => {
    const document = makeDocument(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>',
    );
    const analysis = makeAnalysis();
    const error = makeError('Unclosed element `xml`');

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(true);
  });

  it('treats bracket-path parse errors as false positives', () => {
    const document = makeDocument('{{#with foo[bar-baz]}}{{/with}}');
    const analysis = makeAnalysis();
    const error = makeError("Expecting 'ID', got 'INVALID'", {
      startLine: 1,
      startColumn: 12,
      endLine: 1,
      endColumn: 13,
    });

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(true);
  });

  it('does not suppress unrelated parse errors', () => {
    const document = makeDocument('<div>');
    const analysis = makeAnalysis();
    const error = makeError('Unexpected token');

    expect(
      isKnownGlimmerCompatibilityFalsePositive(document, analysis, error),
    ).toBe(false);
  });
});
