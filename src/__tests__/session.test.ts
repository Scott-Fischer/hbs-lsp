import { describe, expect, it } from 'vitest';
import { TextDocuments } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  createSessionHelpers,
  createSessionState,
  initializeSession,
} from '../session.js';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('initializeSession', () => {
  it('sets configuration capability, deduplicates workspace roots, and applies init options', () => {
    const state = createSessionState();

    initializeSession(
      {
        processId: 1,
        capabilities: {
          workspace: {
            configuration: true,
          },
        },
        workspaceFolders: [
          { uri: 'file:///tmp/workspace-a', name: 'a' },
          { uri: 'file:///tmp/workspace-b', name: 'b' },
        ],
        rootUri: 'file:///tmp/workspace-a',
        initializationOptions: {
          indentSize: 4,
          helpers: ['alpha', 'beta'],
          partials: ['card'],
          partialRoots: ['./partials'],
          maxFullAnalysisChars: 1234,
        },
      },
      state,
    );

    expect(state.hasConfigurationCapability).toBe(true);
    expect(state.workspaceRoots).toEqual([
      '/tmp/workspace-a',
      '/tmp/workspace-b',
    ]);
    expect(state.globalSettings.indentSize).toBe(4);
    expect(state.globalSettings.helpers).toEqual([
      'if',
      'unless',
      'each',
      'with',
      'let',
      'log',
      'lookup',
      'alpha',
      'beta',
    ]);
    expect(state.globalSettings.partials).toEqual(['card']);
    expect(state.globalSettings.partialRoots).toEqual(['./partials']);
    expect(state.globalSettings.maxFullAnalysisChars).toBe(1234);
  });

  it('ignores invalid root uris and falls back to defaults when arrays are not provided', () => {
    const state = createSessionState();

    initializeSession(
      {
        capabilities: {},
        workspaceFolders: [
          { uri: 'file:///tmp/workspace-c', name: 'c' },
          { uri: 'untitled:invalid', name: 'invalid' },
        ],
        rootUri: 'untitled:still-invalid',
        initializationOptions: {
          indentSize: 3,
          helpers: 'not-an-array',
        },
      } as never,
      state,
    );

    expect(state.hasConfigurationCapability).toBe(false);
    expect(state.workspaceRoots).toEqual(['/tmp/workspace-c']);
    expect(state.globalSettings.indentSize).toBe(3);
    expect(state.globalSettings.helpers).toEqual([
      'if',
      'unless',
      'each',
      'with',
      'let',
      'log',
      'lookup',
    ]);
    expect(state.globalSettings.partials).toEqual([]);
    expect(state.globalSettings.partialRoots).toEqual([]);
  });
});

describe('createSessionHelpers', () => {
  it('returns cached document settings per resource when configuration capability is enabled', async () => {
    const state = createSessionState();
    state.hasConfigurationCapability = true;
    state.globalSettings = {
      ...state.globalSettings,
      partialRoots: ['./partials'],
    };

    const documents = new TextDocuments(TextDocument);
    let getConfigurationCount = 0;
    const connection = {
      workspace: {
        getConfiguration: ({ scopeUri }: { scopeUri?: string }) => {
          getConfigurationCount += 1;
          return Promise.resolve({
            indentSize: scopeUri === 'file:///one.hbs' ? 6 : 2,
          });
        },
      },
      sendDiagnostics: () => undefined,
    };

    const helpers = createSessionHelpers(
      connection as never,
      documents,
      state,
      {
        info: () => undefined,
        warn: () => undefined,
      },
    );

    const first = await helpers.getDocumentSettings('file:///one.hbs');
    const second = await helpers.getDocumentSettings('file:///one.hbs');
    const third = await helpers.getDocumentSettings('file:///two.hbs');

    expect(first.indentSize).toBe(6);
    expect(second.indentSize).toBe(6);
    expect(third.indentSize).toBe(2);
    expect(first.partialRoots).toEqual(['./partials']);
    expect(getConfigurationCount).toBe(2);
  });

  it('returns normalized global settings when configuration capability is disabled', async () => {
    const state = createSessionState();
    state.hasConfigurationCapability = false;
    state.globalSettings = {
      ...state.globalSettings,
      indentSize: 5,
      helpers: ['formatDate'],
    };

    const helpers = createSessionHelpers(
      {
        workspace: {
          getConfiguration: () => Promise.resolve({}),
        },
        sendDiagnostics: () => undefined,
      } as never,
      new TextDocuments(TextDocument),
      state,
      {
        info: () => undefined,
        warn: () => undefined,
      },
    );

    const settings = await helpers.getDocumentSettings('file:///example.hbs');
    expect(settings.indentSize).toBe(5);
    expect(settings.helpers).toEqual([
      'if',
      'unless',
      'each',
      'with',
      'let',
      'log',
      'lookup',
      'formatDate',
    ]);
  });

  it('validates all open documents', async () => {
    const state = createSessionState();
    state.hasConfigurationCapability = false;

    const documents = new TextDocuments(TextDocument);
    const doc1 = TextDocument.create(
      'file:///a.hbs',
      'handlebars',
      1,
      '{{#if x}}',
    );
    const doc2 = TextDocument.create(
      'file:///b.hbs',
      'handlebars',
      1,
      '{{name}}',
    );
    const originalAll = documents.all.bind(documents);
    documents.all = () => [doc1, doc2];

    const sentDiagnostics: Array<{ uri: string; diagnostics: unknown[] }> = [];
    const helpers = createSessionHelpers(
      {
        workspace: {
          getConfiguration: () => Promise.resolve({}),
        },
        sendDiagnostics: (payload: { uri: string; diagnostics: unknown[] }) => {
          sentDiagnostics.push(payload);
        },
      } as never,
      documents,
      state,
      {
        info: () => undefined,
        warn: () => undefined,
      },
    );

    await helpers.validateOpenDocuments();
    documents.all = originalAll;

    expect(sentDiagnostics.map((entry) => entry.uri).sort()).toEqual([
      'file:///a.hbs',
      'file:///b.hbs',
    ]);
  });

  it('coalesces concurrent workspace refresh requests', async () => {
    const state = createSessionState();
    state.hasConfigurationCapability = true;

    const documents = new TextDocuments(TextDocument);
    const calls: Array<{ resolve: () => void }> = [];
    let getConfigurationCount = 0;

    const connection = {
      workspace: {
        getConfiguration: () => {
          getConfigurationCount += 1;
          const pending = deferred<void>();
          calls.push({ resolve: () => pending.resolve() });
          return pending.promise.then(() => ({
            helpers: [],
            partials: [],
            partialRoots: [],
          }));
        },
      },
      sendDiagnostics: () => undefined,
    };

    const helpers = createSessionHelpers(
      connection as never,
      documents,
      state,
      {
        info: () => undefined,
        warn: () => undefined,
      },
    );

    const first = helpers.doRefreshWorkspaceIndex();
    const second = helpers.doRefreshWorkspaceIndex();
    const third = helpers.doRefreshWorkspaceIndex();

    await flushMicrotasks();
    expect(getConfigurationCount).toBe(1);

    calls[0]?.resolve();
    await flushMicrotasks();
    expect(getConfigurationCount).toBe(2);

    calls[1]?.resolve();
    await Promise.all([first, second, third]);
    expect(getConfigurationCount).toBe(2);
  });
});
