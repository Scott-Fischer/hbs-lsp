import path from 'node:path';
import type { Connection, TextDocuments } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { summarizeDocument } from '../ast.js';
import type {
  AstSummary,
  IndexedPartialSource,
  ServerSettings,
  WorkspaceIndex,
  WorkspaceIndexRefreshStats,
} from '../types.js';

type WorkspaceIndexResponse = {
  helpers: string[];
  partials: string[];
  partialSources: Record<string, IndexedPartialSource[]>;
  roots: string[];
  stats: WorkspaceIndexRefreshStats | null;
};

export type CustomRequestContext = {
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  doRefreshWorkspaceIndex: () => Promise<void>;
  validateOpenDocuments: () => Promise<void>;
  workspaceIndex: WorkspaceIndex;
  workspaceRoots: string[];
  getServerSettings: () => ServerSettings;
  getLastRefreshStats: () => WorkspaceIndexRefreshStats | null;
};

export function registerCustomRequestHandlers({
  connection,
  documents,
  doRefreshWorkspaceIndex,
  validateOpenDocuments,
  workspaceIndex,
  workspaceRoots,
  getServerSettings,
  getLastRefreshStats,
}: CustomRequestContext): void {
  connection.onRequest('handlebars/reindex', async () => {
    await doRefreshWorkspaceIndex();
    await validateOpenDocuments();
    return buildWorkspaceIndexResponse(
      workspaceIndex,
      workspaceRoots,
      getServerSettings(),
      getLastRefreshStats(),
    );
  });

  connection.onRequest('handlebars/index', () =>
    buildWorkspaceIndexResponse(
      workspaceIndex,
      workspaceRoots,
      getServerSettings(),
      getLastRefreshStats(),
    ),
  );

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

function buildWorkspaceIndexResponse(
  workspaceIndex: WorkspaceIndex,
  workspaceRoots: string[],
  settings: ServerSettings,
  stats: WorkspaceIndexRefreshStats | null,
): WorkspaceIndexResponse {
  const roots = workspaceRoots.map((root, index) =>
    toDisplayPath(
      root,
      workspaceRoots,
      settings.exposeAbsolutePathsInIndex,
      index,
    ),
  );

  return {
    helpers: Array.from(workspaceIndex.helpers).sort(),
    partials: Array.from(workspaceIndex.partials).sort(),
    partialSources: Object.fromEntries(
      Array.from(workspaceIndex.partialSourcesByName.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([partial, sources]) => [
          partial,
          sources.map((source) => ({
            ...source,
            filePath: source.filePath
              ? toDisplayPath(
                  source.filePath,
                  workspaceRoots,
                  settings.exposeAbsolutePathsInIndex,
                )
              : undefined,
            rootPath: source.rootPath
              ? toDisplayPath(
                  source.rootPath,
                  workspaceRoots,
                  settings.exposeAbsolutePathsInIndex,
                )
              : undefined,
          })),
        ]),
    ),
    roots,
    stats,
  };
}

function toDisplayPath(
  candidatePath: string,
  workspaceRoots: string[],
  exposeAbsolutePaths: boolean,
  preferredRootIndex?: number,
): string {
  if (exposeAbsolutePaths) {
    return candidatePath;
  }

  const matchingRootIndex =
    preferredRootIndex ??
    workspaceRoots.findIndex((root) => {
      const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedPath = candidatePath.replace(/\\/g, '/');
      return (
        normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}/`)
      );
    });

  if (matchingRootIndex !== -1) {
    const workspaceLabel = `workspace:${matchingRootIndex + 1}`;
    const relative = path.relative(
      workspaceRoots[matchingRootIndex],
      candidatePath,
    );
    return relative.length > 0
      ? `${workspaceLabel}/${relative}`
      : workspaceLabel;
  }

  return `<external>/${path.basename(candidatePath)}`;
}
