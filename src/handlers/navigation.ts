import { readFile } from 'node:fs/promises';
import type {
  DefinitionLink,
  DocumentSymbolParams,
  FoldingRange,
  LocationLink,
  Range,
} from 'vscode-languageserver/node.js';
import {
  analyzeDocument,
  buildDocumentSymbols,
  buildFoldingRanges,
  extractInlinePartialDefinitions,
} from '../analysis.js';
import { filePathToUri, offsetRange, readTokenAt } from '../utilities.js';
import type { HandlerContext } from './types.js';

export function registerNavigationHandlers({
  connection,
  documents,
  workspaceIndex,
}: HandlerContext): void {
  connection.onDocumentSymbol((params: DocumentSymbolParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const analysis = analyzeDocument(document.getText());
    return buildDocumentSymbols(document, analysis.tokens);
  });

  connection.onFoldingRanges(({ textDocument }): FoldingRange[] => {
    const document = documents.get(textDocument.uri);
    if (!document) {
      return [];
    }

    const analysis = analyzeDocument(document.getText());
    return buildFoldingRanges(document, analysis.tokens);
  });

  connection.onDefinition(
    async ({ textDocument, position }): Promise<DefinitionLink[] | null> => {
      const document = documents.get(textDocument.uri);
      if (!document) {
        return null;
      }

      const text = document.getText();
      const offset = document.offsetAt(position);
      const word = readTokenAt(text, offset);
      if (!word) {
        return null;
      }

      const token = analyzeDocument(text).tokens.find(
        (candidate) =>
          candidate.name === word &&
          offset >= candidate.index &&
          offset <= candidate.index + candidate.length,
      );
      if (!token) {
        return null;
      }

      const wordIndex = text.indexOf(word, token.index);
      const originSelectionRange = offsetRange(
        document,
        wordIndex === -1 ? token.index : wordIndex,
        word.length,
      );

      if (
        (token.type === 'mustache' || token.type === 'block-open') &&
        workspaceIndex.helperFilesByName.has(word)
      ) {
        const helperFiles = workspaceIndex.helperFilesByName.get(word);
        if (!helperFiles || helperFiles.length === 0) {
          return null;
        }

        return Promise.all(
          helperFiles.map(async (filePath): Promise<LocationLink> => {
            const targetSelectionRange = await readHelperTargetSelectionRange(
              filePath,
              word,
            );
            return {
              targetUri: filePathToUri(filePath),
              targetRange: targetSelectionRange,
              targetSelectionRange,
              originSelectionRange,
            };
          }),
        );
      }

      if (token.type !== 'partial') {
        return null;
      }

      const localInlinePartial = extractInlinePartialDefinitions(text).find(
        (candidate) => candidate.name === word,
      );
      if (localInlinePartial) {
        return [
          {
            targetUri: textDocument.uri,
            targetRange: offsetRange(
              document,
              localInlinePartial.fullIndex,
              localInlinePartial.fullLength,
            ),
            targetSelectionRange: offsetRange(
              document,
              localInlinePartial.nameIndex,
              localInlinePartial.nameLength,
            ),
            originSelectionRange,
          },
        ];
      }

      const files = workspaceIndex.partialFilesByName.get(word);
      if (!files || files.length === 0) {
        return null;
      }

      return Promise.all(
        files.map(async (filePath): Promise<LocationLink> => {
          const targetSelectionRange = await readTargetSelectionRange(filePath);
          return {
            targetUri: filePathToUri(filePath),
            targetRange: targetSelectionRange,
            targetSelectionRange,
            originSelectionRange,
          };
        }),
      );
    },
  );
}

async function readHelperTargetSelectionRange(
  filePath: string,
  helperName: string,
): Promise<Range> {
  try {
    const text = await readFile(filePath, 'utf8');
    const patterns = [
      new RegExp(
        String.raw`(?:Handlebars\.)?registerHelper\(\s*['"](${escapeRegExp(helperName)})['"]`,
        'g',
      ),
      new RegExp(
        String.raw`helper\(\s*['"](${escapeRegExp(helperName)})['"]`,
        'g',
      ),
      new RegExp(
        String.raw`export\s+const\s+(${escapeRegExp(helperName)})\s*=\s*(?:helper|\()`,
        'g',
      ),
      new RegExp(
        String.raw`(?:^|\n|,)\s*(?:['"](${escapeRegExp(helperName)})['"]|(${escapeRegExp(helperName)}))\s*:`,
        'g',
      ),
      new RegExp(
        String.raw`(?:^|\n|,)\s*(${escapeRegExp(helperName)})\s*\([^)]*\)\s*\{`,
        'g',
      ),
      new RegExp(
        String.raw`(?:^|\n|,)\s*(${escapeRegExp(helperName)})\s*(?=,|$)`,
        'g',
      ),
      new RegExp(String.raw`\b(${escapeRegExp(helperName)})\b`, 'g'),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) {
        continue;
      }

      const helperIndex = match.index + match[0].indexOf(helperName);
      if (helperIndex >= 0) {
        return rangeFromTextOffset(text, helperIndex, helperName.length);
      }
    }
  } catch {
    return zeroRange();
  }

  return readTargetSelectionRange(filePath);
}

async function readTargetSelectionRange(filePath: string): Promise<Range> {
  try {
    const text = await readFile(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => line.trim().length > 0);
    if (lineIndex === -1) {
      return zeroRange();
    }

    const line = lines[lineIndex];
    const firstNonWhitespace = line.search(/\S/);
    const startCharacter = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
    return {
      start: { line: lineIndex, character: startCharacter },
      end: { line: lineIndex, character: line.length },
    };
  } catch {
    return zeroRange();
  }
}

function rangeFromTextOffset(
  text: string,
  index: number,
  length: number,
): Range {
  const start = positionAtOffset(text, index);
  const end = positionAtOffset(text, index + length);
  return { start, end };
}

function positionAtOffset(
  text: string,
  offset: number,
): { line: number; character: number } {
  const clampedOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clampedOffset);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function zeroRange(): Range {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
}
