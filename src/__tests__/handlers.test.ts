import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  CodeActionParams,
  DocumentFormattingParams,
  DocumentSymbolParams,
  FoldingRangeParams,
  HoverParams,
  Position,
  SemanticTokensParams,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerCodeActionsHandler } from '../handlers/codeActions.js';
import { registerCompletionHandler } from '../handlers/completion.js';
import { registerFormattingHandler } from '../handlers/formatting.js';
import { registerHoverHandler } from '../handlers/hover.js';
import { registerNavigationHandlers } from '../handlers/navigation.js';
import { registerSemanticTokensHandler } from '../handlers/semanticTokens.js';
import {
  defaultSettings,
  type ServerSettings,
  type WorkspaceIndex,
} from '../types.js';

type HandlerMap = {
  completion?: (params: TextDocumentPositionParams) => unknown;
  hover?: (params: HoverParams) => unknown;
  documentFormatting?: (params: DocumentFormattingParams) => unknown;
  documentSymbol?: (params: DocumentSymbolParams) => unknown;
  foldingRanges?: (params: FoldingRangeParams) => unknown;
  definition?: (params: TextDocumentPositionParams) => unknown;
  codeAction?: (params: CodeActionParams) => unknown;
  semanticTokens?: (params: SemanticTokensParams) => unknown;
};

const tmpDir = path.join(os.tmpdir(), `hbs-lsp-handlers-${Date.now()}`);

function createWorkspaceIndex(
  overrides: Partial<WorkspaceIndex> = {},
): WorkspaceIndex {
  return {
    helpers: new Set(),
    helperFilesByName: new Map(),
    partials: new Set(),
    partialFilesByName: new Map(),
    partialSourcesByName: new Map(),
    ...overrides,
  };
}

function createDocuments(document?: TextDocument) {
  return {
    get: (uri: string) => (document?.uri === uri ? document : undefined),
  };
}

function createConnection(handlers: HandlerMap) {
  return {
    onCompletion: (handler: HandlerMap['completion']) => {
      handlers.completion = handler;
    },
    onHover: (handler: HandlerMap['hover']) => {
      handlers.hover = handler;
    },
    onDocumentFormatting: (handler: HandlerMap['documentFormatting']) => {
      handlers.documentFormatting = handler;
    },
    onDocumentSymbol: (handler: HandlerMap['documentSymbol']) => {
      handlers.documentSymbol = handler;
    },
    onFoldingRanges: (handler: HandlerMap['foldingRanges']) => {
      handlers.foldingRanges = handler;
    },
    onDefinition: (handler: HandlerMap['definition']) => {
      handlers.definition = handler;
    },
    onCodeAction: (handler: HandlerMap['codeAction']) => {
      handlers.codeAction = handler;
    },
    languages: {
      semanticTokens: {
        on: (handler: HandlerMap['semanticTokens']) => {
          handlers.semanticTokens = handler;
        },
      },
    },
  };
}

async function getSettings(): Promise<ServerSettings> {
  return defaultSettings;
}

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('handler registration modules', () => {
  it('registers completion handlers that return in-document suggestions', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/completion.hbs',
      'handlebars',
      1,
      '{{sample',
    );

    registerCompletionHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        helpers: ['sampleHelper'],
        partials: [],
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const result = (await handlers.completion?.({
      textDocument: { uri: document.uri },
      position: { line: 0, character: 8 },
    })) as Array<{ label: string }>;

    expect(result.map((item) => item.label)).toEqual(
      expect.arrayContaining(['sampleHelper']),
    );
  });

  it('registers hover handlers that prefer inline partials on name collisions', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/hover.hbs',
      'handlebars',
      1,
      '{{#*inline "sampleHelper"}}x{{/inline}}\n{{> sampleHelper}}',
    );

    registerHoverHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        helpers: ['sampleHelper'],
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const declaration = (await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 0, character: 13 },
    })) as { contents: { value: string } };
    const invocation = (await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 1, character: 6 },
    })) as { contents: { value: string } };

    expect(declaration.contents.value).toContain('Inline partial');
    expect(invocation.contents.value).toContain('Inline partial invocation');
  });

  it('registers hover handlers for helpers, partials, block closers, and unknown positions', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/hover-kinds.hbs',
      'handlebars',
      1,
      '{{sampleHelper value}}\n{{> samplePartial}}\n{{#if cond}}x{{/if}}\nplain text',
    );

    registerHoverHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        helpers: ['sampleHelper'],
        partials: ['samplePartial'],
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const helperHover = (await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 0, character: 4 },
    })) as { contents: { value: string } };
    const partialHover = (await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 1, character: 5 },
    })) as { contents: { value: string } };
    const closingHover = (await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 2, character: 16 },
    })) as { contents: { value: string } };
    const plainHover = await handlers.hover?.({
      textDocument: { uri: document.uri },
      position: { line: 3, character: 2 },
    });

    expect(helperHover.contents.value).toContain('Helper');
    expect(partialHover.contents.value).toContain('Partial');
    expect(closingHover.contents.value).toContain('Closing block tag');
    expect(plainHover).toBeNull();
  });

  it('registers formatting handlers that replace the whole document when formatting changes', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/format.hbs',
      'handlebars',
      1,
      '{{#if condition}}\n{{name}}\n{{/if}}',
    );

    registerFormattingHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        indentSize: 2,
        enableFormatting: true,
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const result = (await handlers.documentFormatting?.({
      textDocument: { uri: document.uri },
      options: { tabSize: 2, insertSpaces: true },
    })) as Array<{ newText: string }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.newText).toContain('  {{name}}');
  });

  it('registers semantic token handlers that return token data for helpers', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/semantic.hbs',
      'handlebars',
      1,
      '{{sampleHelper value}}',
    );

    registerSemanticTokensHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        helpers: ['sampleHelper'],
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const result = (await handlers.semanticTokens?.({
      textDocument: { uri: document.uri },
    })) as { data: number[] };

    expect(result.data.length).toBeGreaterThan(0);
  });

  it('registers code action handlers that return quick fixes for mismatched blocks', async () => {
    const handlers: HandlerMap = {};
    const document = TextDocument.create(
      'file:///tmp/code-actions.hbs',
      'handlebars',
      1,
      '{{#if condition}}\n{{/each}}',
    );

    registerCodeActionsHandler({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: async () => ({
        ...defaultSettings,
        enableFormatting: false,
      }),
      workspaceIndex: createWorkspaceIndex(),
    });

    const result = (await handlers.codeAction?.({
      textDocument: { uri: document.uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 9 },
      },
      context: { diagnostics: [] },
    })) as Array<{ title: string }>;

    expect(result.map((action) => action.title)).toEqual(
      expect.arrayContaining([
        'Rename closing tag to {{/if}}',
        'Append missing closing block tags',
      ]),
    );
  });

  it('registers navigation handlers for document symbols, folding ranges, and helper definitions', async () => {
    const handlers: HandlerMap = {};
    await mkdir(tmpDir, { recursive: true });

    const helperFile = path.join(tmpDir, 'sample-helper.js');
    await writeFile(
      helperFile,
      'export const sampleHelper = helper(function sampleHelper() {});\n',
      'utf8',
    );

    const document = TextDocument.create(
      'file:///tmp/navigation.hbs',
      'handlebars',
      1,
      '{{#if condition}}\n  {{sampleHelper value}}\n{{/if}}',
    );

    registerNavigationHandlers({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: getSettings,
      workspaceIndex: createWorkspaceIndex({
        helpers: new Set(['sampleHelper']),
        helperFilesByName: new Map([['sampleHelper', [helperFile]]]),
      }),
    });

    const symbols = (await handlers.documentSymbol?.({
      textDocument: { uri: document.uri },
    })) as Array<{ name: string }>;
    const foldingRanges = (await handlers.foldingRanges?.({
      textDocument: { uri: document.uri },
    })) as Array<{ startLine: number; endLine: number; kind: string }>;
    const definitions = (await handlers.definition?.({
      textDocument: { uri: document.uri },
      position: { line: 1, character: 5 } as Position,
    })) as Array<{
      targetUri: string;
      targetSelectionRange: { start: { line: number; character: number } };
    }>;

    expect(symbols.map((symbol) => symbol.name)).toEqual(['if']);
    expect(foldingRanges).toEqual([
      { startLine: 0, endLine: 2, kind: 'region' },
    ]);
    expect(definitions[0]?.targetUri).toContain('sample-helper.js');
    expect(definitions[0]?.targetSelectionRange.start).toEqual({
      line: 0,
      character: 13,
    });
  });

  it('registers navigation handlers for inline and file-based partial definitions', async () => {
    const handlers: HandlerMap = {};
    await mkdir(path.join(tmpDir, 'partials'), { recursive: true });

    const partialFile = path.join(tmpDir, 'partials', 'card.hbs');
    await writeFile(partialFile, '<div>Card</div>\n', 'utf8');

    const document = TextDocument.create(
      'file:///tmp/navigation-partials.hbs',
      'handlebars',
      1,
      '{{#*inline "local-card"}}x{{/inline}}\n{{> local-card}}\n{{> card}}',
    );

    registerNavigationHandlers({
      connection: createConnection(handlers) as never,
      documents: createDocuments(document) as never,
      getDocumentSettings: getSettings,
      workspaceIndex: createWorkspaceIndex({
        partials: new Set(['card']),
        partialFilesByName: new Map([['card', [partialFile]]]),
      }),
    });

    const inlineDefinition = (await handlers.definition?.({
      textDocument: { uri: document.uri },
      position: { line: 1, character: 6 } as Position,
    })) as Array<{ targetUri: string }>;
    const fileDefinition = (await handlers.definition?.({
      textDocument: { uri: document.uri },
      position: { line: 2, character: 5 } as Position,
    })) as Array<{ targetUri: string }>;
    const missingDefinition = await handlers.definition?.({
      textDocument: { uri: document.uri },
      position: { line: 0, character: 0 } as Position,
    });

    expect(inlineDefinition[0]?.targetUri).toBe(document.uri);
    expect(fileDefinition[0]?.targetUri).toContain('partials/card.hbs');
    expect(missingDefinition).toBeNull();
  });
});
