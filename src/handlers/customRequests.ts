import type { Connection, TextDocuments } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { summarizeDocument } from '../ast.js';
import type { AstSummary, WorkspaceIndex } from '../types.js';

export type CustomRequestContext = {
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  doRefreshWorkspaceIndex: () => Promise<void>;
  validateOpenDocuments: () => Promise<void>;
  workspaceIndex: WorkspaceIndex;
  workspaceRoots: string[];
};

export function registerCustomRequestHandlers({
  connection,
  documents,
  doRefreshWorkspaceIndex,
  validateOpenDocuments,
  workspaceIndex,
  workspaceRoots,
}: CustomRequestContext): void {
  connection.onRequest('handlebars/reindex', async () => {
    await doRefreshWorkspaceIndex();
    await validateOpenDocuments();
    return {
      helpers: Array.from(workspaceIndex.helpers).sort(),
      partials: Array.from(workspaceIndex.partials).sort(),
      partialSources: Object.fromEntries(
        Array.from(workspaceIndex.partialSourcesByName.entries())
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
      roots: [...workspaceRoots],
    };
  });

  connection.onRequest('handlebars/index', () => ({
    helpers: Array.from(workspaceIndex.helpers).sort(),
    partials: Array.from(workspaceIndex.partials).sort(),
    partialSources: Object.fromEntries(
      Array.from(workspaceIndex.partialSourcesByName.entries())
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    roots: [...workspaceRoots],
  }));

  connection.onRequest(
    'handlebars/ast',
    ({ uri }: { uri: string }): AstSummary | null => {
      const document = documents.get(uri);
      if (!document) {
        return null;
      }

      return summarizeDocument(document);
    },
  );
}
