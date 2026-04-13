import {
  type Diagnostic,
  DiagnosticSeverity,
  Position,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeBlockStructure, analyzeDocument } from './analysis.js';
import { isKnownGlimmerCompatibilityFalsePositive } from './glimmerCompatibility.js';
import type { DocumentAnalysis } from './types.js';
import { offsetRange } from './utilities.js';

export function validateTextDocument(
  textDocument: TextDocument,
  enableDiagnostics: boolean,
  _log?: (message: string) => void,
): Diagnostic[] {
  if (!enableDiagnostics) {
    return [];
  }

  const text = textDocument.getText();
  const analysis = analyzeDocument(text);
  const parseDiagnostics: Diagnostic[] = [];

  for (const parseError of analysis.parseErrors) {
    if (
      !isKnownGlimmerCompatibilityFalsePositive(
        textDocument,
        analysis,
        parseError,
      )
    ) {
      parseDiagnostics.push(toDiagnostic(textDocument, parseError));
    }
  }

  const blockDiagnostics = validateBlockPairs(textDocument, analysis);
  const delimiterDiagnostics = validateHandlebarsBalance(
    textDocument,
    analysis,
  );

  return [
    ...dedupeParseDiagnostics(parseDiagnostics, [
      ...blockDiagnostics,
      ...delimiterDiagnostics,
    ]),
    ...blockDiagnostics,
    ...delimiterDiagnostics,
  ];
}

function toDiagnostic(document: TextDocument, error: unknown): Diagnostic {
  const err = error as {
    message?: string;
    location?: {
      start?: { line?: number; column?: number };
      end?: { line?: number; column?: number };
    };
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
  };
  const message =
    err.message ??
    (error instanceof Error ? error.message : 'Handlebars parse error');

  const messageLocation = extractMessageLocation(message);
  const structuredStartLine = err.location?.start?.line ?? err.startLine;
  const structuredStartColumn = err.location?.start?.column ?? err.startColumn;
  const structuredEndLine = err.location?.end?.line ?? err.endLine;
  const structuredEndColumn = err.location?.end?.column ?? err.endColumn;

  const startLine = Math.max(
    (messageLocation?.line ?? structuredStartLine ?? 1) - 1,
    0,
  );
  const startChar = Math.max(
    messageLocation?.column ?? structuredStartColumn ?? 0,
    0,
  );
  const endLine = Math.max(
    (structuredEndLine ?? messageLocation?.line ?? structuredStartLine ?? 1) -
      1,
    startLine,
  );
  const endChar = Math.max(structuredEndColumn ?? startChar + 1, startChar + 1);

  const lineText = document.getText().split(/\r?\n/)[startLine] ?? '';
  const clampedStartChar = Math.min(
    startChar,
    Math.max(lineText.length - 1, 0),
  );
  const clampedEndChar = Math.max(
    Math.min(endChar, Math.max(lineText.length, clampedStartChar + 1)),
    clampedStartChar + 1,
  );

  return {
    severity: DiagnosticSeverity.Error,
    range: {
      start: Position.create(startLine, clampedStartChar),
      end: Position.create(endLine, clampedEndChar),
    },
    message,
    source: 'hbs-lsp',
  };
}

function extractMessageLocation(
  message: string,
): { line: number; column: number } | null {
  const match = message.match(/@ line\s+(\d+)\s*:\s*column\s+(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    line: Number.parseInt(match[1], 10),
    column: Number.parseInt(match[2], 10),
  };
}

export function validateHandlebarsBalance(
  document: TextDocument,
  analysis?: DocumentAnalysis,
): Diagnostic[] {
  const currentAnalysis = analysis ?? analyzeDocument(document.getText());

  return currentAnalysis.delimiterDiagnostics.map((delimiter) => ({
    severity: DiagnosticSeverity.Warning,
    range: offsetRange(document, delimiter.index, delimiter.length),
    message:
      delimiter.kind === 'unmatched-open'
        ? "Unmatched Handlebars opening delimiter '{{'."
        : "Unmatched Handlebars closing delimiter '}}'.",
    source: 'hbs-lsp',
  }));
}

export function validateBlockPairs(
  document: TextDocument,
  analysis?: DocumentAnalysis,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const blockAnalysis =
    analysis?.blockAnalysis ?? analyzeBlockStructure(document.getText());

  for (const issue of blockAnalysis.issues) {
    if (issue.type === 'stray-else') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: offsetRange(document, issue.token.index, issue.token.length),
        message: "'{{else}}' must appear inside a block.",
        source: 'hbs-lsp',
      });
      continue;
    }

    if (issue.type === 'stray-close') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: offsetRange(document, issue.token.index, issue.token.length),
        message: `Closing block '{{/${issue.token.name}}}' does not have a matching opener.`,
        source: 'hbs-lsp',
      });
      continue;
    }

    if (issue.type === 'mismatch-close') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: offsetRange(document, issue.token.index, issue.token.length),
        message: `Mismatched block close. Expected '{{/${issue.expected}}}' but found '{{/${issue.token.name}}}'.`,
        source: 'hbs-lsp',
      });
      continue;
    }

    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: offsetRange(document, issue.token.index, issue.token.length),
      message: `Block '{{#${issue.token.name}}}' is not closed.`,
      source: 'hbs-lsp',
    });
  }

  return diagnostics;
}

function dedupeParseDiagnostics(
  parseDiagnostics: Diagnostic[],
  specificDiagnostics: Diagnostic[],
): Diagnostic[] {
  return parseDiagnostics.filter(
    (diagnostic) =>
      !specificDiagnostics.some((specific) =>
        rangesOverlap(diagnostic, specific),
      ),
  );
}

function rangesOverlap(left: Diagnostic, right: Diagnostic): boolean {
  const leftStart =
    left.range.start.line * 1_000_000 + left.range.start.character;
  const leftEnd = left.range.end.line * 1_000_000 + left.range.end.character;
  const rightStart =
    right.range.start.line * 1_000_000 + right.range.start.character;
  const rightEnd = right.range.end.line * 1_000_000 + right.range.end.character;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export { analyzeBlockStructure };
