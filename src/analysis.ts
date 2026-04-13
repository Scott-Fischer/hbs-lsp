import type { ASTv1 } from '@glimmer/syntax';
import { preprocess } from '@glimmer/syntax';
import type {
  DocumentSymbol,
  FoldingRange,
} from 'vscode-languageserver/node.js';
import { FoldingRangeKind, SymbolKind } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { sanitizeForGlimmer } from './ast.js';
import type {
  BlockAnalysis,
  BlockIssue,
  BlockToken,
  DelimiterDiagnostic,
  DocumentAnalysis,
  HandlebarsToken,
  ParseErrorInfo,
} from './types.js';
import { offsetRange } from './utilities.js';

const blockOpenRe = /{{~?#(?:\*|>)?\s*([A-Za-z0-9_./-]+)[^}]*~?}}/g;
const blockCloseRe = /{{~?\/\s*([A-Za-z0-9_./-]+)[^}~]*~?}}/g;
const blockElseRe = /{{~?else(?:\s+if\b[^}]*)?\s*~?}}/g;
const partialRe = /{{~?>\s*([A-Za-z0-9_./-]+)[^}]*~?}}/g;
const mustacheRe = /{{~?(?!(?:[#/>!]|else\b))([A-Za-z0-9_./-]+)[^}]*~?}}/g;
const commentRe = /{{!--[\s\S]*?--}}/g;
const inlinePartialOpenRe = /{{~?#\*inline\s+["']([^"']+)["'][^}]*~?}}/g;

let maxFullAnalysisChars = 250_000;

export function configureAnalysisLimits(limits: {
  maxFullAnalysisChars?: number;
}): void {
  if (Number.isFinite(limits.maxFullAnalysisChars)) {
    maxFullAnalysisChars = Math.max(
      Math.floor(limits.maxFullAnalysisChars ?? maxFullAnalysisChars),
      1,
    );
  }
}

export function analyzeDocument(text: string): DocumentAnalysis {
  const tokens = tokenizeHandlebars(text);
  const blockAnalysis = analyzeBlockTokens(tokens);

  if (text.length > maxFullAnalysisChars) {
    return {
      tokens,
      blockAnalysis,
      glimmerAst: null,
      usedSanitization: false,
      parseErrors: [],
      delimiterDiagnostics: [],
    };
  }

  const sanitizedText = sanitizeForGlimmer(text);
  const usedSanitization = sanitizedText !== text;

  let glimmerAst: ASTv1.Template | null = null;
  let parseErrors: ParseErrorInfo[] = [];

  try {
    glimmerAst = preprocess(sanitizedText);
  } catch (error) {
    parseErrors = [normalizeParseError(error)];
  }

  return {
    tokens,
    blockAnalysis,
    glimmerAst,
    usedSanitization,
    parseErrors,
    delimiterDiagnostics: findDelimiterDiagnostics(text, tokens),
  };
}

export function tokenizeHandlebars(text: string): HandlebarsToken[] {
  const tokens: HandlebarsToken[] = [];

  collectMatches(text, commentRe, 'comment', tokens);
  collectMatches(text, blockOpenRe, 'block-open', tokens);
  collectMatches(text, blockCloseRe, 'block-close', tokens);
  collectMatches(text, blockElseRe, 'else', tokens);
  collectMatches(text, partialRe, 'partial', tokens);
  collectMatches(text, mustacheRe, 'mustache', tokens);

  const sorted = tokens.sort(
    (a, b) => a.index - b.index || b.length - a.length,
  );
  const filtered: HandlebarsToken[] = [];

  for (const token of sorted) {
    if (
      filtered.some(
        (existing) =>
          token.index < existing.index + existing.length &&
          existing.index < token.index + token.length,
      )
    ) {
      continue;
    }
    filtered.push(token);
  }

  return filtered;
}

function collectMatches(
  text: string,
  regex: RegExp,
  type: HandlebarsToken['type'],
  out: HandlebarsToken[],
): void {
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    out.push({
      type,
      name: match[1] ?? null,
      index: match.index ?? 0,
      length: raw.length,
      raw,
    });
  }
}

export function analyzeBlockStructure(text: string): BlockAnalysis {
  return analyzeBlockTokens(tokenizeHandlebars(text));
}

function normalizeParseError(error: unknown): ParseErrorInfo {
  const fallback = {
    message: error instanceof Error ? error.message : 'Handlebars parse error',
  } satisfies ParseErrorInfo;

  const parserError = error as {
    message?: string;
    location?: {
      start?: { line?: number; column?: number };
      end?: { line?: number; column?: number };
    };
    hash?: {
      loc?: {
        first_line?: number;
        first_column?: number;
        last_line?: number;
        last_column?: number;
      };
    };
    lineNumber?: number;
    endLineNumber?: number;
    column?: number;
    endColumn?: number;
  };

  if (
    parserError.location?.start ||
    parserError.hash?.loc ||
    parserError.lineNumber
  ) {
    const hashLoc = parserError.hash?.loc;
    return {
      message: parserError.message ?? fallback.message,
      location: {
        startLine:
          parserError.location?.start?.line ??
          hashLoc?.first_line ??
          parserError.lineNumber ??
          1,
        startColumn:
          parserError.location?.start?.column ??
          hashLoc?.first_column ??
          parserError.column ??
          0,
        endLine:
          parserError.location?.end?.line ??
          hashLoc?.last_line ??
          parserError.endLineNumber ??
          parserError.lineNumber ??
          1,
        endColumn:
          parserError.location?.end?.column ??
          hashLoc?.last_column ??
          parserError.endColumn ??
          parserError.column ??
          1,
      },
    };
  }

  return fallback;
}

export function findDelimiterDiagnostics(
  text: string,
  tokens: HandlebarsToken[],
): DelimiterDiagnostic[] {
  const covered = new Array<boolean>(text.length).fill(false);

  for (const token of tokens) {
    for (
      let i = token.index;
      i < token.index + token.length && i < covered.length;
      i += 1
    ) {
      covered[i] = true;
    }
  }

  markBalancedGenericHandlebarsRanges(text, covered);

  const rawTagContentRe = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
  for (const match of text.matchAll(rawTagContentRe)) {
    const raw = match[0];
    const fullIndex = match.index ?? 0;
    const openTagEnd = raw.indexOf('>');
    const closeTagIndex = raw
      .toLowerCase()
      .lastIndexOf(`</${(match[1] ?? '').toLowerCase()}`);
    if (openTagEnd === -1 || closeTagIndex === -1) {
      continue;
    }

    const contentStart = fullIndex + openTagEnd + 1;
    const contentEnd = fullIndex + closeTagIndex;
    for (let i = contentStart; i < contentEnd && i < covered.length; i += 1) {
      covered[i] = true;
    }
  }

  const diagnostics: DelimiterDiagnostic[] = [];

  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if ((pair === '{{' || pair === '}}') && !covered[i] && !covered[i + 1]) {
      diagnostics.push({
        kind: pair === '{{' ? 'unmatched-open' : 'unmatched-close',
        index: i,
        length: 2,
      });
      i += 1;
    }
  }

  return diagnostics;
}

function markBalancedGenericHandlebarsRanges(
  text: string,
  covered: boolean[],
): void {
  for (let i = 0; i < text.length - 1; i += 1) {
    if (!isHandlebarsOpenAt(text, i)) {
      continue;
    }

    let depth = 1;
    let j = i + 2;
    while (j < text.length - 1) {
      if (isHandlebarsOpenAt(text, j)) {
        depth += 1;
        j += 2;
        continue;
      }

      if (isHandlebarsCloseAt(text, j)) {
        depth -= 1;
        j += 2;
        if (depth === 0) {
          for (let k = i; k < j && k < covered.length; k += 1) {
            covered[k] = true;
          }
          i = j - 1;
          break;
        }
        continue;
      }

      j += 1;
    }
  }
}

function isHandlebarsOpenAt(text: string, index: number): boolean {
  return (
    text[index] === '{' && text[index + 1] === '{' && text[index - 1] !== '\\'
  );
}

function isHandlebarsCloseAt(text: string, index: number): boolean {
  return (
    text[index] === '}' && text[index + 1] === '}' && text[index - 1] !== '\\'
  );
}

export type InlinePartialDefinition = {
  name: string;
  fullIndex: number;
  fullLength: number;
  nameIndex: number;
  nameLength: number;
};

export type MatchedBlock = {
  name: string;
  open: BlockToken;
  close: BlockToken | null;
  children: MatchedBlock[];
};

export function extractInlinePartialDefinitions(
  text: string,
): InlinePartialDefinition[] {
  const definitions: InlinePartialDefinition[] = [];

  for (const match of text.matchAll(inlinePartialOpenRe)) {
    const raw = match[0];
    const name = match[1];
    const fullIndex = match.index ?? 0;
    const nameOffset = raw.indexOf(name);
    if (nameOffset === -1) {
      continue;
    }

    definitions.push({
      name,
      fullIndex,
      fullLength: raw.length,
      nameIndex: fullIndex + nameOffset,
      nameLength: name.length,
    });
  }

  return definitions;
}

export function buildMatchedBlocks(tokens: HandlebarsToken[]): MatchedBlock[] {
  const roots: MatchedBlock[] = [];
  const stack: MatchedBlock[] = [];

  for (const token of tokens) {
    if (token.type === 'block-open') {
      const block: MatchedBlock = {
        name: token.name ?? '',
        open: {
          type: 'open',
          name: token.name ?? '',
          index: token.index,
          length: token.length,
        },
        close: null,
        children: [],
      };
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(block);
      } else {
        roots.push(block);
      }
      stack.push(block);
      continue;
    }

    if (token.type !== 'block-close') {
      continue;
    }

    const current = stack[stack.length - 1];
    if (!current || current.name !== token.name) {
      continue;
    }

    current.close = {
      type: 'close',
      name: token.name ?? '',
      index: token.index,
      length: token.length,
    };
    stack.pop();
  }

  return roots;
}

export function buildDocumentSymbols(
  document: TextDocument,
  tokens: HandlebarsToken[],
): DocumentSymbol[] {
  return buildMatchedBlocks(tokens).map((block) =>
    toDocumentSymbol(document, block, SymbolKind.Namespace),
  );
}

function toDocumentSymbol(
  document: TextDocument,
  block: MatchedBlock,
  kind: SymbolKind,
): DocumentSymbol {
  const selectionRange = offsetRange(
    document,
    block.open.index,
    block.open.length,
  );
  const range = block.close
    ? offsetRange(
        document,
        block.open.index,
        block.close.index + block.close.length - block.open.index,
      )
    : selectionRange;

  const inlinePartial = extractInlinePartialDefinitions(
    document.getText({
      start: document.positionAt(block.open.index),
      end: document.positionAt(block.open.index + block.open.length),
    }),
  )[0];

  return {
    name:
      block.name === 'inline' && inlinePartial
        ? `inline: ${inlinePartial.name}`
        : block.name,
    kind,
    range,
    selectionRange,
    detail:
      block.name === 'inline' && inlinePartial
        ? 'Handlebars inline partial'
        : 'Handlebars block',
    children: block.children.map((child) =>
      toDocumentSymbol(document, child, kind),
    ),
  };
}

export function buildFoldingRanges(
  document: TextDocument,
  tokens: HandlebarsToken[],
): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  const visit = (blocks: MatchedBlock[]) => {
    for (const block of blocks) {
      if (block.close) {
        const startLine = document.positionAt(block.open.index).line;
        const endLine = document.positionAt(block.close.index).line;
        if (endLine > startLine) {
          ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
        }
      }
      visit(block.children);
    }
  };

  visit(buildMatchedBlocks(tokens));
  return ranges;
}

export function analyzeBlockTokens(tokens: HandlebarsToken[]): BlockAnalysis {
  const blockTokens: BlockToken[] = tokens
    .filter(
      (token) =>
        token.type === 'block-open' ||
        token.type === 'block-close' ||
        token.type === 'else',
    )
    .map((token) => ({
      type:
        token.type === 'block-open'
          ? 'open'
          : token.type === 'block-close'
            ? 'close'
            : 'else',
      name: token.type === 'else' ? 'else' : (token.name ?? ''),
      index: token.index,
      length: token.length,
    }));

  const openStack: BlockToken[] = [];
  const issues: BlockIssue[] = [];

  for (const token of blockTokens) {
    if (token.type === 'open') {
      openStack.push(token);
      continue;
    }

    if (token.type === 'else') {
      if (openStack.length === 0) {
        issues.push({ type: 'stray-else', token });
      }
      continue;
    }

    const current = openStack[openStack.length - 1];
    if (!current) {
      issues.push({ type: 'stray-close', token });
      continue;
    }

    if (current.name !== token.name) {
      issues.push({ type: 'mismatch-close', token, expected: current.name });
      continue;
    }

    openStack.pop();
  }

  for (const token of openStack) {
    issues.push({ type: 'unclosed-open', token });
  }

  return { issues, openStack };
}
