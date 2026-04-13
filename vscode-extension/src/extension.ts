import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

type WorkspaceIndexResponse = {
  helpers: string[];
  partials: string[];
  partialSources: Record<
    string,
    Array<{
      kind: 'heuristic' | 'partial-root' | 'detected-partialsDir' | 'registered';
      filePath?: string;
      rootPath?: string;
      detail?: string;
    }>
  >;
  roots: string[];
  stats: {
    workspaceRoots: number;
    filesDiscovered: number;
    templateFiles: number;
    sourceFilesRead: number;
    filesSkippedTooLarge: number;
    scanStoppedDueToLimits: boolean;
    durationMs: number;
    limits: {
      maxSourceScanBytes: number;
      maxWorkspaceFiles: number;
      maxWalkDepth: number;
    };
  } | null;
};

let client: LanguageClient | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const serverPath = path.resolve(context.extensionPath, '..', 'dist', 'server.js');

  outputChannel = vscode.window.createOutputChannel('hbs-lsp');
  context.subscriptions.push(outputChannel);

  const serverOptions: ServerOptions = {
    run: {
      command: process.execPath,
      args: [serverPath, '--stdio'],
      transport: TransportKind.stdio,
    },
    debug: {
      command: process.execPath,
      args: [serverPath, '--stdio'],
      transport: TransportKind.stdio,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'handlebars' },
      { scheme: 'untitled', language: 'handlebars' },
    ],
    synchronize: {
      configurationSection: 'handlebars',
    },
    outputChannel,
  };

  client = new LanguageClient(
    'hbs-lsp',
    'hbs-lsp',
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hbs-lsp.showIndex', async () => {
      const index = await requestWorkspaceIndex('handlebars/index');
      if (!index) {
        return;
      }
      showWorkspaceIndex(index, 'Current hbs-lsp workspace index');
    }),
    vscode.commands.registerCommand('hbs-lsp.reindexWorkspace', async () => {
      const index = await requestWorkspaceIndex('handlebars/reindex');
      if (!index) {
        return;
      }
      showWorkspaceIndex(index, 'Refreshed hbs-lsp workspace index');
      void vscode.window.showInformationMessage(
        `hbs-lsp reindexed ${index.partials.length} partial(s) and ${index.helpers.length} helper(s).`,
      );
    }),
  );

  await client.start();
}

async function requestWorkspaceIndex(
  method: 'handlebars/index' | 'handlebars/reindex',
): Promise<WorkspaceIndexResponse | null> {
  if (!client) {
    void vscode.window.showErrorMessage('hbs-lsp client is not running.');
    return null;
  }

  try {
    return await client.sendRequest<WorkspaceIndexResponse>(method);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[error] ${method} failed: ${message}`);
    void vscode.window.showErrorMessage(`hbs-lsp request failed: ${message}`);
    return null;
  }
}

function showWorkspaceIndex(
  index: WorkspaceIndexResponse,
  title: string,
): void {
  outputChannel?.clear();
  outputChannel?.appendLine(title);
  outputChannel?.appendLine('');
  outputChannel?.appendLine('Workspace roots:');
  if (index.roots.length === 0) {
    outputChannel?.appendLine('  (none)');
  } else {
    for (const root of index.roots) {
      outputChannel?.appendLine(`  - ${root}`);
    }
  }

  outputChannel?.appendLine('');
  outputChannel?.appendLine('Refresh stats:');
  if (!index.stats) {
    outputChannel?.appendLine('  (none)');
  } else {
    outputChannel?.appendLine(`  - roots=${index.stats.workspaceRoots}`);
    outputChannel?.appendLine(`  - files=${index.stats.filesDiscovered}`);
    outputChannel?.appendLine(`  - templates=${index.stats.templateFiles}`);
    outputChannel?.appendLine(`  - sourceReads=${index.stats.sourceFilesRead}`);
    outputChannel?.appendLine(`  - skippedLarge=${index.stats.filesSkippedTooLarge}`);
    outputChannel?.appendLine(
      `  - limited=${index.stats.scanStoppedDueToLimits}`,
    );
    outputChannel?.appendLine(`  - durationMs=${index.stats.durationMs}`);
    outputChannel?.appendLine(
      `  - limits bytes=${index.stats.limits.maxSourceScanBytes} files=${index.stats.limits.maxWorkspaceFiles} depth=${index.stats.limits.maxWalkDepth}`,
    );
  }

  outputChannel?.appendLine('');
  outputChannel?.appendLine(`Partials (${index.partials.length}):`);
  if (index.partials.length === 0) {
    outputChannel?.appendLine('  (none)');
  } else {
    for (const partial of index.partials) {
      outputChannel?.appendLine(`  - ${partial}`);
      const sources = index.partialSources[partial] ?? [];
      for (const source of sources) {
        const details = [
          source.kind,
          source.rootPath ? `root=${source.rootPath}` : null,
          source.filePath ? `file=${source.filePath}` : null,
          source.detail ?? null,
        ].filter((value): value is string => Boolean(value));
        outputChannel?.appendLine(`      • ${details.join(' | ')}`);
      }
    }
  }

  outputChannel?.appendLine('');
  outputChannel?.appendLine(`Helpers (${index.helpers.length}):`);
  if (index.helpers.length === 0) {
    outputChannel?.appendLine('  (none)');
  } else {
    for (const helper of index.helpers) {
      outputChannel?.appendLine(`  - ${helper}`);
    }
  }

  outputChannel?.show(true);
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
