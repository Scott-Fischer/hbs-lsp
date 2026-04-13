import { fileURLToPath, pathToFileURL } from 'node:url';
import { Position, type Range } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => value.trim().length > 0)),
  );
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) {
    return null;
  }

  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

export function filePathToUri(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

export function offsetRange(
  document: TextDocument,
  index: number,
  length: number,
): Range {
  return {
    start: document.positionAt(index),
    end: document.positionAt(index + length),
  };
}

export function locationRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): Range {
  return {
    start: Position.create(
      Math.max(startLine - 1, 0),
      Math.max(startColumn, 0),
    ),
    end: Position.create(Math.max(endLine - 1, 0), Math.max(endColumn, 0)),
  };
}

export function rangeLength(document: TextDocument, range: Range): number {
  return document.offsetAt(range.end) - document.offsetAt(range.start);
}

export function readTokenAt(text: string, offset: number): string | null {
  const left = text.slice(0, offset + 1).match(/[A-Za-z0-9_./-]+$/)?.[0] ?? '';
  const right = text.slice(offset + 1).match(/^[A-Za-z0-9_./-]+/)?.[0] ?? '';
  const token = `${left}${right}`;
  return token.length > 0 ? token : null;
}
