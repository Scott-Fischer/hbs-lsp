import { getCompletions } from '../completions.js';
import type { HandlerContext } from './types.js';

export function registerCompletionHandler({
  connection,
  documents,
  getDocumentSettings,
}: HandlerContext): void {
  connection.onCompletion(async ({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    if (!document) {
      return [];
    }

    const settings = await getDocumentSettings(textDocument.uri);
    return getCompletions(document, position, settings);
  });
}
