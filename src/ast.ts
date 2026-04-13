import type { ASTv1 } from '@glimmer/syntax';
import type { Range } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument } from './analysis.js';
import { locationRange } from './utilities.js';

export type TemplateNode = ASTv1.Node;

export function visitTemplateNodes(
  nodes: TemplateNode[],
  visit: (node: TemplateNode) => void,
): void {
  for (const node of nodes) {
    visit(node);

    if ('body' in node && Array.isArray(node.body)) {
      visitTemplateNodes(node.body as TemplateNode[], visit);
    }
    if (
      'program' in node &&
      node.program &&
      'body' in node.program &&
      Array.isArray(node.program.body)
    ) {
      visitTemplateNodes(node.program.body as TemplateNode[], visit);
    }
    if (
      'inverse' in node &&
      node.inverse &&
      'body' in node.inverse &&
      Array.isArray(node.inverse.body)
    ) {
      visitTemplateNodes(node.inverse.body as TemplateNode[], visit);
    }
    if ('children' in node && Array.isArray(node.children)) {
      visitTemplateNodes(node.children as TemplateNode[], visit);
    }
  }
}

export function pathNameRange(
  nodePath:
    | {
        loc?: {
          start?: { line?: number; column?: number };
          end?: { line?: number; column?: number };
        };
      }
    | null
    | undefined,
): Range | null {
  const loc = nodePath?.loc;
  if (!loc?.start || !loc?.end) {
    return null;
  }

  return locationRange(
    loc.start.line ?? 1,
    loc.start.column ?? 0,
    loc.end.line ?? 1,
    loc.end.column ?? 0,
  );
}

/**
 * Glimmer does not accept some real-world Handlebars patterns, especially block
 * helpers used inside HTML/component tag and attribute/property contexts.
 *
 * To keep diagnostics, formatting, and semantic features usable, we mask block
 * open/close/else tokens that appear while scanning inside a tag context before
 * handing the text to Glimmer. This intentionally preserves simple mustaches
 * outside those problematic positions while allowing the rest of the server to
 * fall back to token-based analysis when needed.
 *
 * Current intended support includes:
 * - block helpers in quoted attributes
 * - block helpers in unquoted tag/property positions
 * - `{{else}}` / `{{else if ...}}` inside those contexts
 * - whitespace-control variants like `{{~#if}}` / `{{~/if~}}`
 *
 * This is a compatibility shim, not a full Handlebars parser.
 */
export function sanitizeForGlimmer(text: string): string {
  const chars = text.split('');
  let inTag = false;
  let quoteChar: '"' | "'" | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (!inTag) {
      if (char === '<') {
        const next = text[i + 1];
        if (next && /[A-Za-z!/?.]/.test(next)) {
          inTag = true;
          quoteChar = null;
        }
      }

      continue;
    }

    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = null;
        continue;
      }

      if (char === '{' && text[i + 1] === '{') {
        const length = getBlockTokenLength(text, i);
        if (length > 0) {
          maskRange(chars, i, length);
          i += length - 1;
        }
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }

    if (char === '>') {
      inTag = false;
      continue;
    }

    if (char === '{' && text[i + 1] === '{') {
      const length = getBlockTokenLength(text, i);
      if (length > 0) {
        maskRange(chars, i, length);
        i += length - 1;
      }
    }
  }

  return chars.join('');
}

function getBlockTokenLength(text: string, index: number): number {
  const match = text.slice(index).match(/^{{~?(?:#|\/|else\b)[\s\S]*?~?}}/);
  return match?.[0].length ?? 0;
}

function maskRange(chars: string[], start: number, length: number): void {
  for (let i = start; i < start + length && i < chars.length; i += 1) {
    chars[i] = ' ';
  }
}

export function summarizeDocument(
  document: TextDocument,
): import('./types.js').AstSummary {
  const analysis = analyzeDocument(document.getText());
  const nodes: import('./types.js').AstSummaryNode[] = [];

  for (const token of analysis.tokens) {
    if (token.type === 'block-close' || token.type === 'else') {
      continue;
    }

    const range = {
      start: document.positionAt(token.index),
      end: document.positionAt(token.index + token.length),
    };

    if (token.type === 'comment') {
      nodes.push({ kind: 'comment', name: 'comment', range });
      continue;
    }

    if (token.type === 'block-open' && token.name) {
      nodes.push({ kind: 'block', name: token.name, range });
      continue;
    }

    if (token.type === 'partial' && token.name) {
      nodes.push({ kind: 'partial', name: token.name, range });
      continue;
    }

    if (token.type === 'mustache' && token.name) {
      nodes.push({ kind: 'mustache', name: token.name, range });
    }
  }

  return {
    uri: document.uri,
    nodes,
    blockStackBalanced: analysis.blockAnalysis.openStack.length === 0,
    analysisSource: analysis.glimmerAst ? 'glimmer' : 'fallback',
  };
}
