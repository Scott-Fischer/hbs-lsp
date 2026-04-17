import type {
  Connection,
  InitializeParams,
  TextDocuments,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { configureAnalysisLimits } from './analysis.js';
import { validateTextDocument as runValidation } from './diagnostics.js';
import type {
  ServerSettings,
  WorkspaceIndex,
  WorkspaceIndexRefreshStats,
} from './types.js';
import { defaultSettings } from './types.js';
import { fileUriToPath } from './utilities.js';
import {
  type Logger,
  normalizeSettings,
  refreshWorkspaceIndex,
} from './workspace.js';

export type SessionState = {
  hasConfigurationCapability: boolean;
  globalSettings: ServerSettings;
  documentSettings: Map<string, Thenable<ServerSettings>>;
  workspaceRoots: string[];
  workspaceIndex: WorkspaceIndex;
  lastRefreshStats: WorkspaceIndexRefreshStats | null;
};

export function createSessionState(): SessionState {
  return {
    hasConfigurationCapability: false,
    globalSettings: defaultSettings,
    documentSettings: new Map<string, Thenable<ServerSettings>>(),
    workspaceRoots: [],
    workspaceIndex: {
      helpers: new Set(defaultSettings.helpers),
      helperFilesByName: new Map<string, string[]>(),
      partials: new Set(defaultSettings.partials),
      partialFilesByName: new Map<string, string[]>(),
      partialSourcesByName: new Map(),
    },
    lastRefreshStats: null,
  };
}

export function initializeSession(
  params: InitializeParams,
  state: SessionState,
): void {
  const capabilities = params.capabilities;
  state.hasConfigurationCapability = !!capabilities.workspace?.configuration;

  state.workspaceRoots.length = 0;
  const legacyRootUri = (params as { rootUri?: string }).rootUri;
  const rootCandidates = [
    ...(params.workspaceFolders?.map((folder) => folder.uri) ?? []),
    ...(legacyRootUri ? [legacyRootUri] : []),
  ];
  for (const uri of rootCandidates) {
    const rootPath = fileUriToPath(uri);
    if (rootPath && !state.workspaceRoots.includes(rootPath)) {
      state.workspaceRoots.push(rootPath);
    }
  }

  const init = (params.initializationOptions ?? {}) as Partial<ServerSettings>;
  state.globalSettings = normalizeSettings(
    {
      ...defaultSettings,
      ...init,
      helpers: Array.isArray(init.helpers)
        ? init.helpers
        : defaultSettings.helpers,
      partials: Array.isArray(init.partials)
        ? init.partials
        : defaultSettings.partials,
      partialRoots: Array.isArray(init.partialRoots)
        ? init.partialRoots
        : defaultSettings.partialRoots,
    },
    state.workspaceIndex,
  );
  configureAnalysisLimits({
    maxFullAnalysisChars: state.globalSettings.maxFullAnalysisChars,
  });
}

export function createSessionHelpers(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  state: SessionState,
  logger: Logger,
) {
  let inFlightRefresh: Promise<void> | null = null;
  let pendingRefresh = false;

  async function runRefreshWorkspaceIndex(): Promise<void> {
    if (state.hasConfigurationCapability) {
      const settings = (await connection.workspace.getConfiguration({
        section: 'handlebars',
      })) as Partial<ServerSettings>;
      state.globalSettings = normalizeSettings(
        {
          ...state.globalSettings,
          ...settings,
          helpers: Array.isArray(settings.helpers)
            ? settings.helpers
            : state.globalSettings.helpers,
          partials: Array.isArray(settings.partials)
            ? settings.partials
            : state.globalSettings.partials,
          partialRoots: Array.isArray(settings.partialRoots)
            ? settings.partialRoots
            : state.globalSettings.partialRoots,
        },
        state.workspaceIndex,
      );
      configureAnalysisLimits({
        maxFullAnalysisChars: state.globalSettings.maxFullAnalysisChars,
      });
    }

    state.globalSettings = normalizeSettings(
      state.globalSettings,
      state.workspaceIndex,
    );
    configureAnalysisLimits({
      maxFullAnalysisChars: state.globalSettings.maxFullAnalysisChars,
    });

    state.lastRefreshStats = await refreshWorkspaceIndex(
      state.workspaceIndex,
      state.workspaceRoots,
      state.globalSettings,
      logger,
    );
    state.documentSettings.clear();
  }

  async function doRefreshWorkspaceIndex(): Promise<void> {
    if (inFlightRefresh) {
      pendingRefresh = true;
      await inFlightRefresh;
      return;
    }

    do {
      pendingRefresh = false;
      inFlightRefresh = runRefreshWorkspaceIndex();
      try {
        await inFlightRefresh;
      } finally {
        inFlightRefresh = null;
      }
    } while (pendingRefresh);
  }

  function getDocumentSettings(resource: string): Thenable<ServerSettings> {
    if (!state.hasConfigurationCapability) {
      return Promise.resolve(
        normalizeSettings(state.globalSettings, state.workspaceIndex),
      );
    }

    let result = state.documentSettings.get(resource);
    if (!result) {
      result = connection.workspace
        .getConfiguration({
          scopeUri: resource,
          section: 'handlebars',
        })
        .then((settings) =>
          normalizeSettings(
            {
              ...(settings as Partial<ServerSettings>),
              partialRoots: Array.isArray(
                (settings as Partial<ServerSettings>).partialRoots,
              )
                ? (settings as Partial<ServerSettings>).partialRoots
                : state.globalSettings.partialRoots,
            },
            state.workspaceIndex,
          ),
        );
      state.documentSettings.set(resource, result);
    }

    return result;
  }

  async function validateDocument(textDocument: TextDocument): Promise<void> {
    const settings = await getDocumentSettings(textDocument.uri);
    const diagnostics = runValidation(
      textDocument,
      settings.enableDiagnostics,
      logger.warn,
    );
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  }

  async function validateOpenDocuments(): Promise<void> {
    await Promise.all(documents.all().map(validateDocument));
  }

  return {
    doRefreshWorkspaceIndex,
    getDocumentSettings,
    validateDocument,
    validateOpenDocuments,
    getLastRefreshStats: () => state.lastRefreshStats,
  };
}
