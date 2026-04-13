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

  connection.onDefinition(async ({ textDocument, position }): Promise<DefinitionLink[] | null> => {
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
        candidate.type === 'partial' &&
        candidate.name === word &&
        offset >= candidate.index &&
        offset <= candidate.index + candidate.length,
    );
    if (!token) {
      return null;
    }

    const localInlinePartial = extractInlinePartialDefinitions(text).find(
      (candidate) => candidate.name === word,
    );
    const wordIndex = text.indexOf(word, token.index);
    const originSelectionRange = offsetRange(
      document,
      wordIndex === -1 ? token.index : wordIndex,
      word.length,
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

    const links = await Promise.all(
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

    return links;
  });
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

function zeroRange(): Range {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
}
