import { Range, TextEdit } from 'vscode-languageserver/node.js';
import { formatHandlebars } from '../formatting.js';
import type { HandlerContext } from './types.js';

export function registerFormattingHandler({
  connection,
  documents,
  getDocumentSettings,
}: HandlerContext): void {
  connection.onDocumentFormatting(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const settings = await getDocumentSettings(params.textDocument.uri);
    if (!settings.enableFormatting) {
      return [];
    }

    const original = document.getText();
    const formatted = formatHandlebars(original, settings.indentSize);

    if (formatted === original) {
      return [];
    }

    return [
      TextEdit.replace(
        Range.create(
          document.positionAt(0),
          document.positionAt(original.length),
        ),
        formatted,
      ),
    ];
  });
}
