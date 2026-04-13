import type { ASTv1 } from '@glimmer/syntax';
import {
  type SemanticTokens,
  SemanticTokensBuilder,
  type SemanticTokensLegend,
  type Range,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { analyzeDocument, extractInlinePartialDefinitions } from './analysis.js';
import type { TemplateNode } from './ast.js';
import { pathNameRange, visitTemplateNodes } from './ast.js';
import { offsetRange, rangeLength } from './utilities.js';

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [
    'comment',
    'keyword',
    'function',
    'variable',
    'string',
    'operator',
  ],
  tokenModifiers: ['declaration', 'local'],
};

type PendingSemanticToken = {
  line: number;
  character: number;
  length: number;
  tokenType: string;
  tokenModifiers: string[];
};

function modifierMask(modifiers: string[]): number {
  return modifiers.reduce((mask, modifier) => {
    const index = semanticTokensLegend.tokenModifiers.indexOf(modifier);
    return index === -1 ? mask : mask | (1 << index);
  }, 0);
}

function queueSemanticToken(
  pending: PendingSemanticToken[],
  document: TextDocument,
  range: Range,
  tokenType: string,
  seen: Set<string>,
  tokenModifiers: string[] = [],
): void {
  const length = rangeLength(document, range);
  if (length <= 0 || range.start.line !== range.end.line) {
    return;
  }

  const normalizedModifiers = [...tokenModifiers].sort();
  const key = `${range.start.line}:${range.start.character}:${length}:${tokenType}:${normalizedModifiers.join(',')}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);

  pending.push({
    line: range.start.line,
    character: range.start.character,
    length,
    tokenType,
    tokenModifiers: normalizedModifiers,
  });
}

function flushSemanticTokens(
  builder: SemanticTokensBuilder,
  pending: PendingSemanticToken[],
): void {
  pending
    .sort((left, right) => {
      return (
        left.line - right.line ||
        left.character - right.character ||
        left.length - right.length ||
        left.tokenType.localeCompare(right.tokenType) ||
        left.tokenModifiers.join(',').localeCompare(right.tokenModifiers.join(','))
      );
    })
    .forEach((token) => {
      builder.push(
        token.line,
        token.character,
        token.length,
        semanticTokensLegend.tokenTypes.indexOf(token.tokenType),
        modifierMask(token.tokenModifiers),
      );
    });
}

export function computeSemanticTokens(
  document: TextDocument,
  helpers: string[],
): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const pending: PendingSemanticToken[] = [];
  const seen = new Set<string>();
  const text = document.getText();
  const analysis = analyzeDocument(text);
  const inlinePartialDefinitions = extractInlinePartialDefinitions(text);
  const inlinePartialNames = new Set(
    inlinePartialDefinitions.map((definition) => definition.name),
  );

  for (const definition of inlinePartialDefinitions) {
    queueSemanticToken(
      pending,
      document,
      offsetRange(document, definition.nameIndex, definition.nameLength),
      'function',
      seen,
      ['declaration', 'local'],
    );
  }

  for (const token of analysis.tokens) {
    const tokenRange = offsetRange(document, token.index, token.length);

    if (token.type === 'comment') {
      queueSemanticToken(pending, document, tokenRange, 'comment', seen);
      continue;
    }

    queueSemanticToken(
      pending,
      document,
      offsetRange(document, token.index, 2),
      'operator',
      seen,
    );
    queueSemanticToken(
      pending,
      document,
      offsetRange(document, token.index + token.length - 2, 2),
      'operator',
      seen,
    );

    if (token.type === 'block-open' || token.type === 'block-close') {
      const operatorOffset = token.raw.startsWith('{{~')
        ? token.index + 3
        : token.index + 2;
      queueSemanticToken(
        pending,
        document,
        offsetRange(document, operatorOffset, 1),
        'operator',
        seen,
      );
    }

    if (token.type === 'partial') {
      const rawAfterOpen = token.raw.startsWith('{{~')
        ? token.raw.slice(3)
        : token.raw.slice(2);
      const leadingWhitespace = rawAfterOpen.match(/^\s*/)?.[0].length ?? 0;
      const operatorOffset =
        token.index + (token.raw.startsWith('{{~') ? 3 : 2) + leadingWhitespace;
      queueSemanticToken(
        pending,
        document,
        offsetRange(document, operatorOffset, 1),
        'operator',
        seen,
      );
    }
  }

  if (analysis.glimmerAst) {
    visitTemplateNodes(analysis.glimmerAst.body as TemplateNode[], (node) => {
      if (node.type === 'BlockStatement') {
        const blockNode = node as ASTv1.BlockStatement;
        const nameRange = pathNameRange(blockNode.path);
        if (nameRange) {
          queueSemanticToken(
            pending,
            document,
            nameRange,
            helpers.includes((blockNode.path as ASTv1.PathExpression).original)
              ? 'keyword'
              : 'function',
            seen,
          );
        }
      }

      if (node.type === 'MustacheStatement' || node.type === 'SubExpression') {
        const exprNode = node as ASTv1.MustacheStatement | ASTv1.SubExpression;
        const nameRange = pathNameRange(exprNode.path);
        if (nameRange) {
          queueSemanticToken(
            pending,
            document,
            nameRange,
            helpers.includes((exprNode.path as ASTv1.PathExpression).original)
              ? 'keyword'
              : 'variable',
            seen,
          );
        }
      }
    });

    visitTemplateNodes(analysis.glimmerAst.body as TemplateNode[], (node) => {
      if (
        node.type === 'MustacheStatement' ||
        node.type === 'SubExpression' ||
        node.type === 'BlockStatement'
      ) {
        const callNode = node as
          | ASTv1.MustacheStatement
          | ASTv1.SubExpression
          | ASTv1.BlockStatement;
        for (const param of callNode.params) {
          if (
            param.type === 'StringLiteral' &&
            param.loc?.start &&
            param.loc?.end
          ) {
            queueSemanticToken(
              pending,
              document,
              {
                start: {
                  line: param.loc.start.line - 1,
                  character: param.loc.start.column,
                },
                end: {
                  line: param.loc.end.line - 1,
                  character: param.loc.end.column,
                },
              },
              'string',
              seen,
            );
          }
        }
        for (const pair of callNode.hash.pairs) {
          if (
            pair.value.type === 'StringLiteral' &&
            pair.value.loc?.start &&
            pair.value.loc?.end
          ) {
            queueSemanticToken(
              pending,
              document,
              {
                start: {
                  line: pair.value.loc.start.line - 1,
                  character: pair.value.loc.start.column,
                },
                end: {
                  line: pair.value.loc.end.line - 1,
                  character: pair.value.loc.end.column,
                },
              },
              'string',
              seen,
            );
          }
        }
      }
    });
  } else {
    for (const token of analysis.tokens) {
      if (!token.name) {
        continue;
      }

      const tokenStart = token.index + token.raw.lastIndexOf(token.name);
      const tokenType = helpers.includes(token.name)
        ? 'keyword'
        : token.type === 'partial' ||
            token.type === 'block-open' ||
            token.type === 'block-close'
          ? 'function'
          : 'variable';
      const tokenModifiers =
        token.type === 'partial' && inlinePartialNames.has(token.name)
          ? ['local']
          : [];
      queueSemanticToken(
        pending,
        document,
        offsetRange(document, tokenStart, token.name.length),
        tokenType,
        seen,
        tokenModifiers,
      );
    }
  }

  flushSemanticTokens(builder, pending);
  return builder.build();
}
