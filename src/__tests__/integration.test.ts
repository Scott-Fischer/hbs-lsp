import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node.js';
import type {
  CodeAction,
  CompletionItem,
  CompletionList,
  Definition,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
  SemanticTokens,
} from 'vscode-languageserver-protocol';
import { semanticTokensLegend } from '../semanticTokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '..', 'server.ts');

/** Spawn the LSP server and return a JSON-RPC MessageConnection. */
function startServer(): {
  connection: MessageConnection;
  process: ChildProcess;
} {
  const child = spawn('npx', ['tsx', SERVER_PATH, '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const reader = new StreamMessageReader(child.stdout!);
  const writer = new StreamMessageWriter(child.stdin!);
  const connection = createMessageConnection(reader, writer);

  connection.listen();
  return { connection, process: child };
}

/** Create standard InitializeParams. */
function initParams(overrides?: Partial<InitializeParams>): InitializeParams {
  return {
    processId: process.pid,
    rootUri: 'file:///tmp/hbs-lsp-test',
    capabilities: {
      textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        semanticTokens: {
          requests: { full: true },
          tokenTypes: [],
          tokenModifiers: [],
          formats: ['relative'],
          multilineTokenSupport: false,
          overlappingTokenSupport: false,
          augmentsSyntaxTokens: true,
          dynamicRegistration: false,
          serverCancelSupport: false,
        },
      },
    },
    workspaceFolders: null,
    ...overrides,
  };
}

/** Wait for a publishDiagnostics notification matching the given URI. */
function waitForDiagnostics(
  conn: MessageConnection,
  uri: string,
  timeout = 5000,
): Promise<PublishDiagnosticsParams> {
  return new Promise<PublishDiagnosticsParams>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for diagnostics on ${uri}`)),
      timeout,
    );
    const disposable = conn.onNotification(
      'textDocument/publishDiagnostics',
      (params: PublishDiagnosticsParams) => {
        if (params.uri === uri) {
          clearTimeout(timer);
          disposable.dispose();
          resolve(params);
        }
      },
    );
  });
}

/** Send textDocument/didOpen and wait for diagnostics on that URI. */
function openAndGetDiagnostics(
  conn: MessageConnection,
  uri: string,
  text: string,
): Promise<PublishDiagnosticsParams> {
  const diagPromise = waitForDiagnostics(conn, uri);

  conn.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'handlebars', version: 1, text },
  });

  return diagPromise;
}

function openDocument(
  conn: MessageConnection,
  uri: string,
  text: string,
): void {
  conn.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'handlebars', version: 1, text },
  });
}

function decodeSemanticTokens(text: string, data: number[]) {
  const lines = text.split(/\r?\n/);
  const tokens: Array<{
    line: number;
    start: number;
    text: string;
    type: string;
  }> = [];
  let line = 0;
  let character = 0;

  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
    const length = data[i + 2];
    const type = semanticTokensLegend.tokenTypes[data[i + 3]];
    const tokenText = lines[line]?.slice(character, character + length) ?? '';
    tokens.push({ line, start: character, text: tokenText, type });
  }

  return tokens;
}

describe('LSP Integration', () => {
  const tmpRoot = '/tmp/hbs-lsp-test';
  let connection: MessageConnection;
  let serverProcess: ChildProcess;
  let initResult: InitializeResult;

  beforeAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    await mkdir(tmpRoot, { recursive: true });
    const server = startServer();
    connection = server.connection;
    serverProcess = server.process;

    initResult = await connection.sendRequest<InitializeResult>(
      'initialize',
      initParams({
        initializationOptions: {
          indentSize: 2,
          enableDiagnostics: true,
          enableFormatting: true,
          helpers: ['if', 'each', 'with', 'unless', 'helperA'],
          partials: ['foo', 'bar'],
          maxFullAnalysisChars: 250000,
        },
      }),
    );

    connection.sendNotification('initialized', {});
  }, 10000);

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    if (connection) {
      await connection.sendRequest('shutdown');
      connection.sendNotification('exit');
      connection.dispose();
    }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  });

  // ── Initialize ────────────────────────────────────────────

  it('returns expected capabilities on initialize', () => {
    const caps = initResult.capabilities;
    expect(caps.textDocumentSync).toBeDefined();
    expect(caps.completionProvider).toBeDefined();
    expect(caps.completionProvider!.triggerCharacters).toEqual(
      expect.arrayContaining(['{', '#', '/']),
    );
    expect(caps.documentFormattingProvider).toBe(true);
    expect(caps.documentSymbolProvider).toBe(true);
    expect(caps.foldingRangeProvider).toBe(true);
    expect(caps.definitionProvider).toBe(true);
    expect(caps.codeActionProvider).toBe(true);
    expect(caps.hoverProvider).toBe(true);
    expect(caps.semanticTokensProvider).toBeDefined();
  });

  // ── Diagnostics ───────────────────────────────────────────

  it('publishes diagnostics for unclosed block tags', async () => {
    const result = await openAndGetDiagnostics(
      connection,
      'file:///tmp/hbs-lsp-test/unclosed.hbs',
      '{{#if condition}}Hello',
    );

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const unclosed = result.diagnostics.find((d) =>
      d.message.includes('not closed'),
    );
    expect(unclosed).toBeDefined();
    expect(unclosed!.source).toBe('hbs-lsp');
  });

  it('publishes diagnostics for mismatched block tags', async () => {
    const result = await openAndGetDiagnostics(
      connection,
      'file:///tmp/hbs-lsp-test/mismatch.hbs',
      '{{#if condition}}Hello{{/each}}',
    );

    expect(result.diagnostics.length).toBeGreaterThan(0);
    const mismatch = result.diagnostics.find((d) =>
      d.message.includes('Mismatched'),
    );
    expect(mismatch).toBeDefined();
  });

  it('publishes empty diagnostics for valid templates', async () => {
    const result = await openAndGetDiagnostics(
      connection,
      'file:///tmp/hbs-lsp-test/valid.hbs',
      '{{#if condition}}Hello{{/if}}',
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  // ── Completions ───────────────────────────────────────────

  it('returns completion items for helper context', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/complete.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text: '{{#' },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<
      CompletionList | CompletionItem[]
    >('textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 3 },
    });

    const items = Array.isArray(result) ? result : result.items;
    expect(items.length).toBeGreaterThan(0);

    const labels = items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['{{#if}}']));
  });

  it('returns configured helpers in completions', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/helper-complete.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text: '{{' },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<
      CompletionList | CompletionItem[]
    >('textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 2 },
    });

    const items = Array.isArray(result) ? result : result.items;
    const labels = items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['helperA']));
  });

  it('returns inline partials in completions', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/example-inline-complete.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text: '{{#*inline "example"}}x{{/inline}}\n{{> ',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<
      CompletionList | CompletionItem[]
    >('textDocument/completion', {
      textDocument: { uri },
      position: { line: 1, character: 3 },
    });

    const items = Array.isArray(result) ? result : result.items;
    const labels = items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(['example']));
  });

  // ── Hover ─────────────────────────────────────────────────

  it('returns hover for a known helper', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/hover.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text: '{{helperA value}}',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Hover | null>(
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 0, character: 5 },
      },
    );

    expect(result).not.toBeNull();
    expect(result!.contents).toBeDefined();
    const content =
      typeof result!.contents === 'string'
        ? result!.contents
        : 'value' in result!.contents
          ? result!.contents.value
          : '';
    expect(content).toContain('helperA');
  });

  it('returns hover for a known partial', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/hover-partial.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text: '{{> foo}}',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Hover | null>(
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 0, character: 5 },
      },
    );

    expect(result).not.toBeNull();
    const content =
      typeof result!.contents === 'string'
        ? result!.contents
        : 'value' in result!.contents
          ? result!.contents.value
          : '';
    expect(content).toContain('foo');
    expect(content).toContain('Partial');
  });

  it('returns contextual hover for an unindexed partial invocation', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/hover-unknown-partial.hbs';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text: '{{> x/y}}',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Hover | null>(
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 0, character: 6 },
      },
    );

    expect(result).not.toBeNull();
    const content =
      typeof result!.contents === 'string'
        ? result!.contents
        : 'value' in result!.contents
          ? result!.contents.value
          : '';
    expect(content).toContain('Partial invocation');
    expect(content).toContain('x/y');
  });

  it('returns hover for inline partial declarations and invocations', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/example-inline-hover.hbs';
    const text = '{{#*inline "example"}}x{{/inline}}\n{{> example}}';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text,
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const declarationHover = await connection.sendRequest<Hover | null>(
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 0, character: 13 },
      },
    );
    const invocationHover = await connection.sendRequest<Hover | null>(
      'textDocument/hover',
      {
        textDocument: { uri },
        position: { line: 1, character: 6 },
      },
    );

    const declarationContent =
      declarationHover &&
      typeof declarationHover.contents !== 'string' &&
      'value' in declarationHover.contents
        ? declarationHover.contents.value
        : '';
    const invocationContent =
      invocationHover &&
      typeof invocationHover.contents !== 'string' &&
      'value' in invocationHover.contents
        ? invocationHover.contents.value
        : '';

    expect(declarationContent).toContain('Inline partial');
    expect(invocationContent).toContain('Inline partial');
  });

  // ── Definition ────────────────────────────────────────────

  it('resolves partial definitions to indexed files', async () => {
    const partialPath = path.join(
      tmpRoot,
      'x',
      'components',
      'foo',
      'partials',
      'bar.hbs',
    );
    await mkdir(path.dirname(partialPath), { recursive: true });
    await writeFile(partialPath, '<div>Example</div>', 'utf8');

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition.hbs';
    openDocument(connection, uri, '{{> foo/partials/bar}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 14 },
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri:
            'file:///tmp/hbs-lsp-test/x/components/foo/partials/bar.hbs',
        }),
      ]),
    );
  });

  it('resolves inline partial definitions within the same document', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/definition-inline.hbs';
    openDocument(
      connection,
      uri,
      '{{#*inline "example"}}x{{/inline}}\n{{> example}}',
    );
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 1, character: 6 },
      },
    );

    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetUri: uri })]),
    );
  });

  it('resolves helper definitions to indexed source files', async () => {
    const helperPath = path.join(tmpRoot, 'src', 'helpers.ts');
    await mkdir(path.dirname(helperPath), { recursive: true });
    await writeFile(
      helperPath,
      'export const formatDate = helper(function formatDate() {});\n',
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-helper.hbs';
    openDocument(connection, uri, '{{formatDate createdAt}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: 'file:///tmp/hbs-lsp-test/src/helpers.ts',
        }),
      ]),
    );
  });

  it('resolves imported ExpressHandlebars helper bag definitions to indexed source files', async () => {
    const helperModulePath = path.join(tmpRoot, 'src', 'helpers.js');
    const enginePath = path.join(tmpRoot, 'src', 'engine.js');
    await mkdir(path.dirname(helperModulePath), { recursive: true });
    await writeFile(
      helperModulePath,
      `
      module.exports = {
        formatDate(value) { return value; },
      };
      `,
      'utf8',
    );
    await writeFile(
      enginePath,
      `
      const helpers = require('./helpers');

      const expressHandlebars = new ExpressHandlebars({
        helpers,
        partialsDir: ['./server/views/partials'],
      });
      `,
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-helper-bag.hbs';
    openDocument(connection, uri, '{{formatDate createdAt}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: 'file:///tmp/hbs-lsp-test/src/helpers.js',
        }),
      ]),
    );
  });

  it('resolves spread-imported helper definitions to indexed source files', async () => {
    const sharedPath = path.join(tmpRoot, 'src', 'shared-helpers.js');
    const helperModulePath = path.join(
      tmpRoot,
      'src',
      'helpers-with-spread.js',
    );
    const enginePath = path.join(tmpRoot, 'src', 'engine-spread.js');
    await mkdir(path.dirname(sharedPath), { recursive: true });
    await writeFile(
      sharedPath,
      `
      module.exports = {
        formatDate(value) { return value; },
      };
      `,
      'utf8',
    );
    await writeFile(
      helperModulePath,
      `
      const sharedHelpers = require('./shared-helpers');

      module.exports = {
        featureFlag,
        ...sharedHelpers,
      };
      `,
      'utf8',
    );
    await writeFile(
      enginePath,
      `
      const helpers = require('./helpers-with-spread');

      const expressHandlebars = new ExpressHandlebars({
        helpers,
        partialsDir: ['./server/views/partials'],
      });
      `,
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-helper-spread.hbs';
    openDocument(connection, uri, '{{formatDate createdAt}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: 'file:///tmp/hbs-lsp-test/src/shared-helpers.js',
        }),
      ]),
    );
  });

  it('resolves block helper definitions to indexed source files', async () => {
    const helperPath = path.join(tmpRoot, 'src', 'block-helper.js');
    await mkdir(path.dirname(helperPath), { recursive: true });
    await writeFile(
      helperPath,
      `
      module.exports = {
        formatDate(value) { return value; },
      };
      `,
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-block-helper.hbs';
    openDocument(connection, uri, '{{#formatDate createdAt}}x{{/formatDate}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 5 },
      },
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: 'file:///tmp/hbs-lsp-test/src/block-helper.js',
        }),
      ]),
    );
  });

  it('targets exported const helper names precisely in definition results', async () => {
    const helperPath = path.join(tmpRoot, 'src', 'definition-target-export.ts');
    await mkdir(path.dirname(helperPath), { recursive: true });
    await writeFile(
      helperPath,
      'export const preciseHelper = helper(function preciseHelper() {});\n',
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-target-export.hbs';
    openDocument(connection, uri, '{{preciseHelper value}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    const firstLink =
      Array.isArray(result) && result[0] && 'targetSelectionRange' in result[0]
        ? result[0]
        : null;
    expect(firstLink?.targetSelectionRange).toEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 26 },
    });
  });

  it('targets shorthand helper names precisely in definition results', async () => {
    const helperPath = path.join(
      tmpRoot,
      'src',
      'definition-target-shorthand.js',
    );
    await mkdir(path.dirname(helperPath), { recursive: true });
    await writeFile(
      helperPath,
      `
      const shorthandHelper = value => value;
      module.exports = {
        shorthandHelper,
      };
      `,
      'utf8',
    );

    await connection.sendRequest('handlebars/reindex');

    const uri = 'file:///tmp/hbs-lsp-test/definition-target-shorthand.hbs';
    openDocument(connection, uri, '{{shorthandHelper value}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    const firstLink =
      Array.isArray(result) && result[0] && 'targetSelectionRange' in result[0]
        ? result[0]
        : null;
    expect(firstLink?.targetSelectionRange).toEqual({
      start: { line: 3, character: 8 },
      end: { line: 3, character: 23 },
    });
  });

  it('returns null for non-indexed helpers', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/definition-missing-helper.hbs';
    openDocument(connection, uri, '{{missingHelper value}}');
    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<Definition | null>(
      'textDocument/definition',
      {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      },
    );

    expect(result).toBeNull();
  });

  // ── Formatting ────────────────────────────────────────────

  it('formats a poorly indented template', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/format.hbs';
    const text = '{{#if condition}}\n{{name}}\n{{/if}}';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text },
    });

    await new Promise((r) => setTimeout(r, 100));

    const edits = await connection.sendRequest<
      import('vscode-languageserver-protocol').TextEdit[]
    >('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });

    expect(edits.length).toBeGreaterThan(0);
    const newText = edits[0].newText;
    expect(newText).toContain('  {{name}}');
  });

  it('returns no edits for an already formatted template', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/format-clean.hbs';
    const text = '{{#if condition}}\n  {{name}}\n{{/if}}';

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text },
    });

    await new Promise((r) => setTimeout(r, 100));

    const edits = await connection.sendRequest<
      import('vscode-languageserver-protocol').TextEdit[]
    >('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });

    expect(edits).toHaveLength(0);
  });

  // ── Document Symbols ──────────────────────────────────────

  it('returns nested document symbols for block helpers', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/symbols.hbs';

    openDocument(
      connection,
      uri,
      '{{#if show}}\n  {{#each items}}\n    {{name}}\n  {{/each}}\n{{/if}}',
    );

    await new Promise((r) => setTimeout(r, 100));

    const symbols = await connection.sendRequest<DocumentSymbol[]>(
      'textDocument/documentSymbol',
      {
        textDocument: { uri },
      },
    );

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('if');
    expect(symbols[0].children).toHaveLength(1);
    expect(symbols[0].children?.[0].name).toBe('each');
  });

  it('labels inline partial blocks in document symbols', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/example-inline-symbols.hbs';

    openDocument(connection, uri, '{{#*inline "example"}}\n  x\n{{/inline}}');

    await new Promise((r) => setTimeout(r, 100));

    const symbols = await connection.sendRequest<DocumentSymbol[]>(
      'textDocument/documentSymbol',
      {
        textDocument: { uri },
      },
    );

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('inline: example');
    expect(symbols[0].detail).toContain('inline partial');
  });

  // ── Folding Ranges ────────────────────────────────────────

  it('returns document symbols for malformed templates when blocks are still discoverable', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/symbols-malformed.hbs';

    openDocument(
      connection,
      uri,
      '{{#if show}}\n  {{#each items}}\n    {{name}}',
    );

    await new Promise((r) => setTimeout(r, 100));

    const symbols = await connection.sendRequest<DocumentSymbol[]>(
      'textDocument/documentSymbol',
      {
        textDocument: { uri },
      },
    );

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('if');
    expect(symbols[0].children?.[0].name).toBe('each');
  });

  it('returns folding ranges for nested block helpers', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/folding.hbs';

    openDocument(
      connection,
      uri,
      '{{#if show}}\n  {{#each items}}\n    content\n  {{/each}}\n{{/if}}',
    );

    await new Promise((r) => setTimeout(r, 100));

    const ranges = await connection.sendRequest<FoldingRange[]>(
      'textDocument/foldingRange',
      {
        textDocument: { uri },
      },
    );

    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(
      ranges.some((range) => range.startLine === 0 && range.endLine === 4),
    ).toBe(true);
    expect(
      ranges.some((range) => range.startLine === 1 && range.endLine === 3),
    ).toBe(true);
  });

  // ── Semantic Tokens ───────────────────────────────────────

  it('returns semantic tokens for template expressions', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/tokens.hbs';

    openDocument(connection, uri, '{{#if condition}}{{name}}{{/if}}');

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<SemanticTokens>(
      'textDocument/semanticTokens/full',
      { textDocument: { uri } },
    );

    expect(result).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('does not emit semantic operator tokens for plain HTML', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/plain-html-tokens.hbs';
    const text = '<div><span># plain / html ></span></div>';

    openDocument(connection, uri, text);

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<SemanticTokens>(
      'textDocument/semanticTokens/full',
      { textDocument: { uri } },
    );

    const decoded = decodeSemanticTokens(text, result.data);
    expect(decoded.filter((token) => token.type === 'operator')).toHaveLength(
      0,
    );
  });

  it('returns folding ranges for malformed templates when matching closures exist', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/folding-malformed.hbs';

    openDocument(
      connection,
      uri,
      '{{#if show}}\n  {{#each items}}\n    content\n{{/if}}',
    );

    await new Promise((r) => setTimeout(r, 100));

    const ranges = await connection.sendRequest<FoldingRange[]>(
      'textDocument/foldingRange',
      {
        textDocument: { uri },
      },
    );

    expect(
      ranges.some((range) => range.startLine === 1 && range.endLine === 3),
    ).toBe(false);
    expect(ranges).toHaveLength(0);
  });

  // ── Code Actions ──────────────────────────────────────────

  it('offers quick fix for unclosed block tag', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/codeaction.hbs';
    const text = '{{#if condition}}\n  Hello\n';

    const diagPromise = waitForDiagnostics(connection, uri);

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text },
    });

    await diagPromise;

    const actions = await connection.sendRequest<CodeAction[]>(
      'textDocument/codeAction',
      {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 0 },
        },
        context: { diagnostics: [] },
      },
    );

    expect(actions.length).toBeGreaterThan(0);
    const appendFix = actions.find((a) => a.title.includes('missing closing'));
    expect(appendFix).toBeDefined();
  });

  it('offers quick fix for mismatched closing tag', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/codeaction-mismatch.hbs';
    const text = '{{#if condition}}Hello{{/each}}';

    const diagPromise2 = waitForDiagnostics(connection, uri);

    connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'handlebars', version: 1, text },
    });

    await diagPromise2;

    const actions = await connection.sendRequest<CodeAction[]>(
      'textDocument/codeAction',
      {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 30 },
        },
        context: { diagnostics: [] },
      },
    );

    const renameFix = actions.find((a) =>
      a.title.includes('Rename closing tag'),
    );
    expect(renameFix).toBeDefined();
    expect(renameFix!.title).toContain('if');
  });

  it('offers code actions for malformed templates with stray else blocks', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/codeaction-stray-else.hbs';
    const text = '{{else}}';

    const diagPromise = waitForDiagnostics(connection, uri);
    openDocument(connection, uri, text);
    await diagPromise;

    const actions = await connection.sendRequest<CodeAction[]>(
      'textDocument/codeAction',
      {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: text.length },
        },
        context: { diagnostics: [] },
      },
    );

    expect(actions.some((action) => action.title.includes('stray else'))).toBe(
      true,
    );
  });

  // ── Custom Requests ───────────────────────────────────────

  it('returns AST summary via handlebars/ast', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/ast.hbs';

    openDocument(connection, uri, '{{#if show}}\n  {{name}}\n{{/if}}');

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<{
      uri: string;
      nodes: Array<{ kind: string; name: string }>;
      blockStackBalanced: boolean;
      analysisSource: 'glimmer' | 'fallback';
    }>('handlebars/ast', { uri });

    expect(result).not.toBeNull();
    expect(result.uri).toBe(uri);
    expect(result.blockStackBalanced).toBe(true);
    expect(result.analysisSource).toBe('glimmer');

    const kinds = result.nodes.map((n) => n.kind);
    expect(kinds).toContain('block');
    expect(kinds).not.toContain('partial');
    expect(kinds).toContain('mustache');

    const blockNode = result.nodes.find((n) => n.kind === 'block');
    expect(blockNode!.name).toBe('if');
  });

  it('returns fallback AST summaries for malformed templates', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/ast-fallback.hbs';

    openDocument(connection, uri, '{{#if show}}\n  {{name}}');

    await new Promise((r) => setTimeout(r, 100));

    const result = await connection.sendRequest<{
      uri: string;
      nodes: Array<{ kind: string; name: string }>;
      blockStackBalanced: boolean;
      analysisSource: 'glimmer' | 'fallback';
    }>('handlebars/ast', { uri });

    expect(result.analysisSource).toBe('fallback');
    expect(result.blockStackBalanced).toBe(false);
    expect(
      result.nodes.some((node) => node.kind === 'block' && node.name === 'if'),
    ).toBe(true);
  });

  it('returns a redacted workspace index with refresh stats via handlebars/index', async () => {
    const partialPath = path.join(tmpRoot, 'partials', 'index-check.hbs');
    await mkdir(path.dirname(partialPath), { recursive: true });
    await writeFile(partialPath, '<div>Index</div>', 'utf8');

    const reindexed = await connection.sendRequest<{
      helpers: string[];
      partials: string[];
      roots: string[];
      partialSources: Record<
        string,
        Array<{ filePath?: string; rootPath?: string; kind: string }>
      >;
      stats: {
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
    }>('handlebars/reindex');

    const result =
      await connection.sendRequest<typeof reindexed>('handlebars/index');

    expect(result).toBeDefined();
    expect(Array.isArray(result.helpers)).toBe(true);
    expect(Array.isArray(result.partials)).toBe(true);
    expect(Array.isArray(result.roots)).toBe(true);
    expect(result.roots).toEqual(['workspace:1']);

    expect(result.helpers).toEqual(
      expect.arrayContaining(['if', 'each', 'with']),
    );
    expect(result.partials).toEqual(expect.arrayContaining(['index-check']));
    expect(result.partialSources['index-check']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'workspace:1/partials/index-check.hbs',
        }),
      ]),
    );
    expect(result.stats).not.toBeNull();
    expect(result.stats?.filesDiscovered).toBeGreaterThan(0);
    expect(result.stats?.templateFiles).toBeGreaterThan(0);
    expect(result.stats?.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.stats?.limits.maxWalkDepth).toBe(32);
  });

  // ── didChange ─────────────────────────────────────────────

  it('limits full analysis for large documents when configured', async () => {
    const limitedServer = startServer();
    const limitedConnection = limitedServer.connection;
    const limitedProcess = limitedServer.process;

    try {
      await limitedConnection.sendRequest<InitializeResult>(
        'initialize',
        initParams({
          initializationOptions: {
            maxFullAnalysisChars: 10,
          },
        }),
      );
      limitedConnection.sendNotification('initialized', {});

      const result = await openAndGetDiagnostics(
        limitedConnection,
        'file:///tmp/hbs-lsp-test/large-analysis-limit.hbs',
        '{{#if ready}}abcdefghijklmnopqrstuvwxyz',
      );

      expect(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.includes('not closed'),
        ),
      ).toBe(true);
      expect(
        result.diagnostics.some((diagnostic) =>
          diagnostic.message.toLowerCase().includes('parse error'),
        ),
      ).toBe(false);
    } finally {
      await limitedConnection.sendRequest('shutdown');
      limitedConnection.sendNotification('exit');
      limitedConnection.dispose();
      if (!limitedProcess.killed) {
        limitedProcess.kill();
      }
    }
  });

  it('re-validates after document change', async () => {
    const uri = 'file:///tmp/hbs-lsp-test/change.hbs';

    const openDiagPromise = waitForDiagnostics(connection, uri);

    connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'handlebars',
        version: 1,
        text: '{{#if a}}b{{/if}}',
      },
    });

    const openResult = await openDiagPromise;
    expect(openResult.diagnostics).toHaveLength(0);

    const changeDiagPromise = new Promise<PublishDiagnosticsParams>(
      (resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error('Timed out waiting for non-empty diagnostics')),
          5000,
        );
        const disposable = connection.onNotification(
          'textDocument/publishDiagnostics',
          (params: PublishDiagnosticsParams) => {
            if (params.uri === uri && params.diagnostics.length > 0) {
              clearTimeout(timer);
              disposable.dispose();
              resolve(params);
            }
          },
        );
      },
    );

    connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: '{{#if a}}b{{/each}}' }],
    });

    const changeResult = await changeDiagPromise;
    expect(changeResult.diagnostics.length).toBeGreaterThan(0);
  });
});
