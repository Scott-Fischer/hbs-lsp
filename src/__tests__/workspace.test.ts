import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultSettings, type WorkspaceIndex } from '../types.js';
import {
  extractHelpersFromFile,
  extractRegisteredPartialsFromFile,
  inferPartialName,
  inferPartialNames,
  type Logger,
  refreshWorkspaceIndex,
  walkFiles,
} from '../workspace.js';

describe('inferPartialName', () => {
  it('extracts name from partials directory', () => {
    expect(inferPartialName('/app/partials/foo.hbs')).toBe('foo');
  });

  it('extracts name from templates directory', () => {
    expect(inferPartialName('/app/templates/bar.handlebars')).toBe('bar');
  });

  it('extracts name from views directory', () => {
    expect(inferPartialName('/app/views/baz.hbs')).toBe('baz');
  });

  it('strips leading underscore', () => {
    expect(inferPartialName('/app/partials/_foo.hbs')).toBe('foo');
  });

  it('preserves nested path in partials directory', () => {
    expect(inferPartialName('/app/partials/x/nav.hbs')).toBe('x/nav');
  });

  it('falls back to basename for non-standard directories', () => {
    expect(inferPartialName('/app/components/q.hbs')).toBe('q');
  });

  it('strips underscore from basename fallback', () => {
    expect(inferPartialName('/app/components/_q.hbs')).toBe('q');
  });

  it('returns null for empty basename', () => {
    expect(inferPartialName('/app/.hbs')).toBe(null);
  });

  it('handles Windows-style paths', () => {
    expect(inferPartialName('C:\\app\\partials\\foo.hbs')).toBe('foo');
  });

  it('returns additional workspace-relative aliases when a workspace root is provided', () => {
    expect(inferPartialNames('/app/foo/partials/bar.hbs', '/app')).toEqual(
      expect.arrayContaining(['bar', 'foo/partials/bar']),
    );
  });

  it('returns component partial aliases for component partial paths', () => {
    expect(
      inferPartialNames('/app/x/components/foo/partials/bar.hbs', '/app'),
    ).toEqual(
      expect.arrayContaining([
        'bar',
        'foo/partials/bar',
        'x/components/foo/partials/bar',
      ]),
    );
  });

  it('returns component partial aliases regardless of path prefix', () => {
    expect(
      inferPartialNames(
        '/repo/packages/ui/components/foo/partials/bar.hbs',
        '/repo',
      ),
    ).toEqual(
      expect.arrayContaining([
        'bar',
        'foo/partials/bar',
        'packages/ui/components/foo/partials/bar',
      ]),
    );
  });
});

describe('walkFiles', () => {
  const tmpDir = path.join(os.tmpdir(), 'hbs-lsp-walk-test-' + Date.now());

  it('skips common generated and dependency directories', async () => {
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await mkdir(path.join(tmpDir, 'coverage'), { recursive: true });
    await mkdir(path.join(tmpDir, '.next'), { recursive: true });
    await mkdir(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });

    await writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      'export const app = true;',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'coverage', 'ignored.js'),
      'registerHelper("bad")',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, '.next', 'ignored.js'),
      'registerHelper("bad")',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'node_modules', 'pkg', 'ignored.js'),
      'registerHelper("bad")',
      'utf8',
    );

    const files = await walkFiles(tmpDir);
    expect(files).toContain(path.join(tmpDir, 'src', 'app.ts'));
    expect(files).not.toContain(path.join(tmpDir, 'coverage', 'ignored.js'));
    expect(files).not.toContain(path.join(tmpDir, '.next', 'ignored.js'));
    expect(files).not.toContain(
      path.join(tmpDir, 'node_modules', 'pkg', 'ignored.js'),
    );
  });

  it('honors simple .gitignore directory and file patterns', async () => {
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await mkdir(path.join(tmpDir, 'generated'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.gitignore'),
      'generated/\nignored.ts\n',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'src', 'keep.ts'),
      'export const keep = true;',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'generated', 'skip.ts'),
      'export const skip = true;',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'ignored.ts'),
      'export const ignored = true;',
      'utf8',
    );

    const files = await walkFiles(tmpDir);
    expect(files).toContain(path.join(tmpDir, 'src', 'keep.ts'));
    expect(files).not.toContain(path.join(tmpDir, 'generated', 'skip.ts'));
    expect(files).not.toContain(path.join(tmpDir, 'ignored.ts'));
  });

  it('supports simple negated .gitignore patterns', async () => {
    await mkdir(path.join(tmpDir, 'logs'), { recursive: true });
    await writeFile(
      path.join(tmpDir, '.gitignore'),
      '*.log\n!important.log\n',
      'utf8',
    );
    await writeFile(path.join(tmpDir, 'error.log'), 'bad', 'utf8');
    await writeFile(path.join(tmpDir, 'important.log'), 'keep', 'utf8');

    const files = await walkFiles(tmpDir);
    expect(files).not.toContain(path.join(tmpDir, 'error.log'));
    expect(files).toContain(path.join(tmpDir, 'important.log'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});

describe('refreshWorkspaceIndex', () => {
  const tmpDir = path.join(os.tmpdir(), 'hbs-lsp-index-test-' + Date.now());

  it('indexes both canonical and workspace-relative partial names', async () => {
    await mkdir(path.join(tmpDir, 'foo', 'partials'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'foo', 'partials', 'bar.hbs'),
      '<div></div>',
      'utf8',
    );

    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };

    const stats = await refreshWorkspaceIndex(workspaceIndex, [tmpDir]);

    expect(stats.workspaceRoots).toBe(1);
    expect(stats.filesDiscovered).toBeGreaterThan(0);
    expect(stats.templateFiles).toBeGreaterThan(0);
    expect(Array.from(workspaceIndex.partials)).toEqual(
      expect.arrayContaining(['bar', 'foo/partials/bar']),
    );
    expect(workspaceIndex.partialFilesByName.get('foo/partials/bar')).toEqual([
      path.join(tmpDir, 'foo', 'partials', 'bar.hbs'),
    ]);
    expect(workspaceIndex.partialSourcesByName.get('foo/partials/bar')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'heuristic' })]),
    );
  });

  it('indexes names relative to configured partial roots', async () => {
    await mkdir(path.join(tmpDir, 'x', 'components', 'm', 'partials'), {
      recursive: true,
    });
    await writeFile(
      path.join(tmpDir, 'x', 'components', 'm', 'partials', 'n.hbs'),
      '<div></div>',
      'utf8',
    );

    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };

    await refreshWorkspaceIndex(workspaceIndex, [tmpDir], {
      ...defaultSettings,
      partialRoots: ['./x/components'],
    });

    expect(Array.from(workspaceIndex.partials)).toEqual(
      expect.arrayContaining(['m/partials/n']),
    );
    expect(workspaceIndex.partialFilesByName.get('m/partials/n')).toEqual([
      path.join(tmpDir, 'x', 'components', 'm', 'partials', 'n.hbs'),
    ]);
    expect(workspaceIndex.partialSourcesByName.get('m/partials/n')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'partial-root' }),
      ]),
    );
  });

  it('auto-detects express-handlebars partial roots from partialsDir config', async () => {
    await mkdir(path.join(tmpDir, 'partials', 'x'), {
      recursive: true,
    });
    await writeFile(
      path.join(tmpDir, 'partials', 'x', 'foo.hbs'),
      '<div></div>',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'app.ts'),
      `const engine = new Engine({ partialsDir: ['./partials'] });`,
      'utf8',
    );

    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };

    await refreshWorkspaceIndex(workspaceIndex, [tmpDir]);

    expect(Array.from(workspaceIndex.partials)).toEqual(
      expect.arrayContaining(['x/foo']),
    );
    expect(workspaceIndex.partialSourcesByName.get('x/foo')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'detected-partialsDir' }),
      ]),
    );
  });

  it('indexes partials registered in JS/TS files', async () => {
    await writeFile(
      path.join(tmpDir, 'partials.ts'),
      `
      Handlebars.registerPartial('x/foo', '<div></div>');
      registerPartial({
        'y/bar': '<div></div>',
        baz: '<div></div>',
      });
      `,
      'utf8',
    );

    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };

    await refreshWorkspaceIndex(workspaceIndex, [tmpDir]);

    expect(Array.from(workspaceIndex.partials)).toEqual(
      expect.arrayContaining(['x/foo', 'y/bar', 'baz']),
    );
    expect(workspaceIndex.partialSourcesByName.get('x/foo')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'registered' })]),
    );
  });

  it('skips very large files while detecting partial roots', async () => {
    await mkdir(path.join(tmpDir, 'large-partials'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'large-partials', 'foo.hbs'),
      '<div></div>',
      'utf8',
    );
    await writeFile(
      path.join(tmpDir, 'huge-config.ts'),
      `const engine = { partialsDir: ['./large-partials'] }\n${'a'.repeat(600_000)}`,
      'utf8',
    );

    const workspaceIndex: WorkspaceIndex = {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };

    await refreshWorkspaceIndex(workspaceIndex, [tmpDir]);

    expect(
      workspaceIndex.partialSourcesByName
        .get('foo')
        ?.some((source) => source.kind === 'detected-partialsDir') ?? false,
    ).toBe(false);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});

describe('extractRegisteredPartialsFromFile', () => {
  const tmpDir = path.join(
    os.tmpdir(),
    'hbs-lsp-registered-partials-test-' + Date.now(),
  );

  async function writeTmpFile(name: string, content: string): Promise<string> {
    await mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, name);
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('extracts direct registerPartial calls', async () => {
    const filePath = await writeTmpFile(
      'partials.js',
      `
      Handlebars.registerPartial('foo', '<div></div>');
      registerPartial("x/bar", '<div></div>');
      `,
    );
    const partials = await extractRegisteredPartialsFromFile(filePath);
    expect(partials).toEqual(expect.arrayContaining(['foo', 'x/bar']));
  });

  it('extracts object-style registerPartial calls', async () => {
    const filePath = await writeTmpFile(
      'partials-object.ts',
      `
      registerPartial({
        baz: '<div></div>',
        'x/y': '<div></div>',
      });
      `,
    );
    const partials = await extractRegisteredPartialsFromFile(filePath);
    expect(partials).toEqual(expect.arrayContaining(['baz', 'x/y']));
  });

  it('skips very large source files', async () => {
    const filePath = await writeTmpFile(
      'partials-large.ts',
      'a'.repeat(600_000),
    );
    const partials = await extractRegisteredPartialsFromFile(filePath);
    expect(partials).toHaveLength(0);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});

describe('extractHelpersFromFile', () => {
  const tmpDir = path.join(os.tmpdir(), 'hbs-lsp-test-' + Date.now());

  async function writeTmpFile(name: string, content: string): Promise<string> {
    await mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, name);
    await writeFile(filePath, content, 'utf8');
    return filePath;
  }

  it('extracts registerHelper calls', async () => {
    const filePath = await writeTmpFile(
      'helpers.js',
      `
      Handlebars.registerHelper('helperA', function(value) {});
      Handlebars.registerHelper("uppercase", function(str) {});
    `,
    );
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toContain('helperA');
    expect(helpers).toContain('uppercase');
  });

  it('extracts helper() calls', async () => {
    const filePath = await writeTmpFile(
      'helpers2.js',
      `
      helper('truncate', function(str) {});
    `,
    );
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toContain('truncate');
  });

  it('extracts exported const helper pattern', async () => {
    const filePath = await writeTmpFile(
      'helpers3.ts',
      `
      export const myHelper = helper(function() {});
    `,
    );
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toContain('myHelper');
  });

  it('returns empty for non-JS files', async () => {
    const filePath = await writeTmpFile(
      'template.hbs',
      '{{#if condition}}{{/if}}',
    );
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toHaveLength(0);
  });

  it('returns empty for non-existent files', async () => {
    const helpers = await extractHelpersFromFile('/nonexistent/file.js');
    expect(helpers).toHaveLength(0);
  });

  it('handles files with no helpers', async () => {
    const filePath = await writeTmpFile('empty.js', 'const x = 1;');
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toHaveLength(0);
  });

  it('skips very large source files', async () => {
    const largeContent = 'a'.repeat(600_000);
    const filePath = await writeTmpFile('large.js', largeContent);
    const helpers = await extractHelpersFromFile(filePath);
    expect(helpers).toHaveLength(0);
  });

  it('reuses cached helper extraction results for unchanged files', async () => {
    const filePath = await writeTmpFile(
      'cached.js',
      `Handlebars.registerHelper('helperA', function(value) {});`,
    );
    const messages: string[] = [];
    const logger: Logger = {
      info: (message) => messages.push(message),
      warn: (message) => messages.push(message),
    };

    const first = await extractHelpersFromFile(filePath, logger);
    const second = await extractHelpersFromFile(filePath, logger);

    expect(first).toContain('helperA');
    expect(second).toContain('helperA');
    expect(
      messages.some((message) => message.includes('Using cached helper scan')),
    ).toBe(true);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});

describe('refreshWorkspaceIndex cache bounding', () => {
  const tmpDir = path.join(os.tmpdir(), 'hbs-lsp-reindex-test-' + Date.now());

  function makeIndex(): WorkspaceIndex {
    return {
      helpers: new Set(),
      partials: new Set(),
      partialFilesByName: new Map(),
      partialSourcesByName: new Map(),
    };
  }

  it('removes a deleted helper file from helperExtractionCache after second reindex', async () => {
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    const helperFile = path.join(tmpDir, 'src', 'myHelper.js');
    await writeFile(
      helperFile,
      `Handlebars.registerHelper('myHelper', function() {});`,
      'utf8',
    );

    const index = makeIndex();
    await refreshWorkspaceIndex(index, [tmpDir]);
    expect(index.helpers.has('myHelper')).toBe(true);

    await rm(helperFile);

    await refreshWorkspaceIndex(index, [tmpDir]);
    expect(index.helpers.has('myHelper')).toBe(false);
  });

  it('clears gitignorePatternCache at the start of each reindex', async () => {
    await mkdir(path.join(tmpDir, 'src2'), { recursive: true });
    await writeFile(
      path.join(tmpDir, 'src2', 'app.ts'),
      'const x = 1;',
      'utf8',
    );

    const index = makeIndex();
    await refreshWorkspaceIndex(index, [tmpDir]);
    await refreshWorkspaceIndex(index, [tmpDir]);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});
