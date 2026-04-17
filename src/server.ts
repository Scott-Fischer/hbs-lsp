#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Connection,
  createConnection,
  DidChangeConfigurationNotification,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerCodeActionsHandler } from './handlers/codeActions.js';
import { registerCompletionHandler } from './handlers/completion.js';
import { registerCustomRequestHandlers } from './handlers/customRequests.js';
import { registerFormattingHandler } from './handlers/formatting.js';
import { registerHoverHandler } from './handlers/hover.js';
import { registerNavigationHandlers } from './handlers/navigation.js';
import { registerSemanticTokensHandler } from './handlers/semanticTokens.js';
import { semanticTokensLegend } from './semanticTokens.js';
import {
  createSessionHelpers,
  createSessionState,
  initializeSession,
} from './session.js';
import type { Logger } from './workspace.js';

const helpText = `
hbs-lsp - A lightweight Language Server Protocol server for Handlebars templates

Usage:
  hbs-lsp            Start the LSP server (communicates over stdio)
  hbs-lsp --help     Show this help message
  hbs-lsp --version  Show version number
  hbs-lsp --stdio    Use stdio transport (default; accepted for client compatibility)

Documentation: https://github.com/Scott-Fischer/hbs-lsp
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${helpText}\n`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const pkgPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'package.json',
  );
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      version: string;
      bundledInExtensionVersion?: string;
    };
    const versionText = pkg.bundledInExtensionVersion
      ? `${pkg.version} (bundled in hbs-lsp-vscode ${pkg.bundledInExtensionVersion})`
      : pkg.version;
    process.stdout.write(`${versionText}\n`);
  } catch {
    process.stdout.write('unknown\n');
  }
  process.exit(0);
}

// --stdio is accepted for LSP client compatibility; stdio is always the transport.
// --help and --version are handled above; all other unknown flags are ignored.

const connection: Connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const logger: Logger = {
  info: (message) => connection.console.log(message),
  warn: (message) => connection.console.warn(message),
};

const session = createSessionState();
const sessionHelpers = createSessionHelpers(
  connection,
  documents,
  session,
  logger,
);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  initializeSession(params, session);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['{', '#', '/', '>', ' '],
      },
      documentFormattingProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      definitionProvider: true,
      codeActionProvider: true,
      hoverProvider: true,
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true,
        range: false,
      },
    },
  };
});

connection.onInitialized(() => {
  if (session.hasConfigurationCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined,
    );
  }

  void sessionHelpers.doRefreshWorkspaceIndex();
});

connection.onDidChangeConfiguration((change) => {
  if (session.hasConfigurationCapability) {
    session.documentSettings.clear();
  } else {
    session.globalSettings = {
      ...session.globalSettings,
      ...change.settings.handlebars,
    };
  }

  void sessionHelpers
    .doRefreshWorkspaceIndex()
    .then(sessionHelpers.validateOpenDocuments);
});

documents.onDidClose((e) => {
  session.documentSettings.delete(e.document.uri);
});

documents.onDidChangeContent((change) => {
  void sessionHelpers.validateDocument(change.document);
});

documents.onDidOpen((change) => {
  void sessionHelpers.validateDocument(change.document);
});

registerCompletionHandler({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerHoverHandler({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerSemanticTokensHandler({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerFormattingHandler({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerNavigationHandlers({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerCodeActionsHandler({
  connection,
  documents,
  getDocumentSettings: sessionHelpers.getDocumentSettings,
  workspaceIndex: session.workspaceIndex,
});
registerCustomRequestHandlers({
  connection,
  documents,
  doRefreshWorkspaceIndex: sessionHelpers.doRefreshWorkspaceIndex,
  validateOpenDocuments: sessionHelpers.validateOpenDocuments,
  workspaceIndex: session.workspaceIndex,
  workspaceRoots: session.workspaceRoots,
  getServerSettings: () => session.globalSettings,
  getLastRefreshStats: sessionHelpers.getLastRefreshStats,
});

documents.listen(connection);
connection.listen();
