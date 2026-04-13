import { computeSemanticTokens } from '../semanticTokens.js';
import type { HandlerContext } from './types.js';

export function registerSemanticTokensHandler({
  connection,
  documents,
  getDocumentSettings,
}: HandlerContext): void {
  connection.languages.semanticTokens.on(async ({ textDocument }) => {
    const document = documents.get(textDocument.uri);
    if (!document) {
      return { data: [] };
    }

    const settings = await getDocumentSettings(textDocument.uri);
    return computeSemanticTokens(document, settings.helpers);
  });
}
