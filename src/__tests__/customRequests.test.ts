import { describe, expect, it } from 'vitest';
import { TextDocuments } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerCustomRequestHandlers } from '../handlers/customRequests.js';
import { defaultSettings, type WorkspaceIndex } from '../types.js';

describe('registerCustomRequestHandlers', () => {
  it('redacts absolute paths in workspace index responses by default', async () => {
    const requests = new Map<string, (...args: any[]) => unknown>();
    const connection = {
      onRequest: (method: string, handler: (...args: any[]) => unknown) => {
        requests.set(method, handler);
      },
    };

    const workspaceRoot = '/tmp/workspace-root';
    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(['if', 'helperA']),
      partials: new Set(['x/foo']),
      partialFilesByName: new Map([
        ['x/foo', [`${workspaceRoot}/partials/x/foo.hbs`]],
      ]),
      partialSourcesByName: new Map([
        [
          'x/foo',
          [
            {
              kind: 'partial-root',
              filePath: `${workspaceRoot}/partials/x/foo.hbs`,
              rootPath: `${workspaceRoot}/partials`,
            },
          ],
        ],
      ]),
    };

    registerCustomRequestHandlers({
      connection: connection as never,
      documents: new TextDocuments(TextDocument),
      doRefreshWorkspaceIndex: async () => undefined,
      validateOpenDocuments: async () => undefined,
      workspaceIndex,
      workspaceRoots: [workspaceRoot],
      getServerSettings: () => defaultSettings,
      getLastRefreshStats: () => ({
        workspaceRoots: 1,
        filesDiscovered: 3,
        templateFiles: 1,
        sourceFilesRead: 2,
        filesSkippedTooLarge: 0,
        scanStoppedDueToLimits: false,
        durationMs: 12,
        limits: {
          maxSourceScanBytes: defaultSettings.maxSourceScanBytes,
          maxWorkspaceFiles: defaultSettings.maxWorkspaceFiles,
          maxWalkDepth: defaultSettings.maxWalkDepth,
        },
      }),
    });

    const handler = requests.get('handlebars/index');
    expect(handler).toBeTypeOf('function');

    const result = handler?.() as {
      roots: string[];
      partialSources: Record<
        string,
        Array<{ filePath?: string; rootPath?: string }>
      >;
      stats: { filesDiscovered: number } | null;
    };

    expect(result.roots).toEqual(['workspace:1']);
    expect(result.partialSources['x/foo']?.[0]?.filePath).toBe(
      'workspace:1/partials/x/foo.hbs',
    );
    expect(result.partialSources['x/foo']?.[0]?.rootPath).toBe(
      'workspace:1/partials',
    );
    expect(result.stats?.filesDiscovered).toBe(3);
  });
});
