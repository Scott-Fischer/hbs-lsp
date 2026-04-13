import type { Dirent, Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  IndexedPartialSource,
  ServerSettings,
  WorkspaceIndex,
  WorkspaceIndexRefreshStats,
} from './types.js';
import { defaultSettings } from './types.js';
import { uniqueStrings } from './utilities.js';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'tmp',
  'temp',
  'build',
  'static',
  'out',
]);

type ScanLimits = Pick<
  ServerSettings,
  'maxSourceScanBytes' | 'maxWorkspaceFiles' | 'maxWalkDepth'
>;

const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxSourceScanBytes: defaultSettings.maxSourceScanBytes,
  maxWorkspaceFiles: defaultSettings.maxWorkspaceFiles,
  maxWalkDepth: defaultSettings.maxWalkDepth,
};

const helperExtractionCache = new Map<
  string,
  {
    mtimeMs: number;
    size: number;
    helpers: string[];
  }
>();

const gitignorePatternCache = new Map<string, GitignoreRule[]>();

type GitignoreRule = {
  pattern: string;
  dirOnly: boolean;
  negated: boolean;
};

export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export async function walkFiles(
  root: string,
  logger?: Logger,
  out: string[] = [],
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string[]> {
  gitignorePatternCache.delete(root);
  const gitignoreRules = await loadGitignoreRules(root, logger);
  return walkFilesWithRules(
    root,
    root,
    gitignoreRules,
    logger,
    out,
    0,
    scanLimits,
    refreshStats,
  );
}

async function walkFilesWithRules(
  root: string,
  currentDir: string,
  gitignoreRules: GitignoreRule[],
  logger?: Logger,
  out: string[] = [],
  depth = 0,
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    logger?.warn(
      `Failed to read directory ${currentDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return out;
  }

  if (depth > scanLimits.maxWalkDepth) {
    if (refreshStats) {
      refreshStats.scanStoppedDueToLimits = true;
    }
    logger?.warn(
      `Skipping directory ${currentDir}: exceeded maximum workspace scan depth of ${scanLimits.maxWalkDepth}`,
    );
    return out;
  }

  for (const entry of entries) {
    if (out.length >= scanLimits.maxWorkspaceFiles) {
      if (refreshStats) {
        refreshStats.scanStoppedDueToLimits = true;
      }
      logger?.warn(
        `Stopping workspace scan at ${scanLimits.maxWorkspaceFiles} files under ${root}`,
      );
      return out;
    }
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    const ignoredByGitignore = matchesGitignore(
      relativePath,
      entry.isDirectory(),
      gitignoreRules,
    );
    if (ignoredByGitignore) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkFilesWithRules(
        root,
        fullPath,
        gitignoreRules,
        logger,
        out,
        depth + 1,
        scanLimits,
        refreshStats,
      );
    } else if (entry.isFile()) {
      out.push(fullPath);
      if (refreshStats) {
        refreshStats.filesDiscovered += 1;
      }
    }
  }

  return out;
}

async function loadGitignoreRules(
  root: string,
  logger?: Logger,
): Promise<GitignoreRule[]> {
  const cached = gitignorePatternCache.get(root);
  if (cached) {
    return cached;
  }

  const gitignorePath = path.join(root, '.gitignore');
  try {
    const content = await readFile(gitignorePath, 'utf8');
    const rules = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const negated = line.startsWith('!');
        const pattern = (negated ? line.slice(1) : line)
          .replace(/^\.\//, '')
          .replace(/^\//, '');
        return {
          pattern: pattern.replace(/\/$/, ''),
          dirOnly: /\/$/.test(negated ? line.slice(1) : line),
          negated,
        } satisfies GitignoreRule;
      })
      .filter((rule) => rule.pattern.length > 0);
    gitignorePatternCache.set(root, rules);
    return rules;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger?.warn(
        `Failed to read .gitignore ${gitignorePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    gitignorePatternCache.set(root, []);
    return [];
  }
}

function matchesGitignore(
  relativePath: string,
  isDirectory: boolean,
  rules: GitignoreRule[],
): boolean {
  let ignored = false;

  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) {
      continue;
    }

    if (matchesGitignoreRule(relativePath, rule.pattern)) {
      ignored = !rule.negated;
    }
  }

  return ignored;
}

function matchesGitignoreRule(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  if (!normalizedPattern.includes('/')) {
    return normalizedPath
      .split('/')
      .some((segment) => globToRegExp(normalizedPattern).test(segment));
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${regexSource}(?:$|/)`);
}

export function inferPartialName(filePath: string): string | null {
  return inferPartialNames(filePath)[0] ?? null;
}

export function inferPartialNames(
  filePath: string,
  workspaceRoot?: string,
): string[] {
  const normalized = filePath.replace(/\\/g, '/');
  const names = new Set<string>();

  const match = normalized.match(
    /(?:^|\/)(?:partials|templates|views)\/(.+?)\.(?:hbs|handlebars)$/i,
  );
  if (match) {
    addPartialAlias(names, match[1]);
  }

  const componentRelativePartial =
    inferComponentRelativePartialAlias(normalized);
  if (componentRelativePartial) {
    addPartialAlias(names, componentRelativePartial);
  }

  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (
      normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`)
    ) {
      const relative = path
        .relative(workspaceRoot, filePath)
        .replace(/\\/g, '/')
        .replace(/\.(?:hbs|handlebars)$/i, '');
      addPartialAlias(names, relative);
    }
  }

  const base = path.basename(filePath).replace(/\.(?:hbs|handlebars)$/i, '');
  addPartialAlias(names, base);

  return Array.from(names);
}

function addPartialAlias(names: Set<string>, value: string): void {
  const normalized = normalizePartialPath(value);
  if (normalized) {
    names.add(normalized);
  }
}

function inferComponentRelativePartialAlias(filePath: string): string | null {
  const extensionless = filePath.replace(/\.(?:hbs|handlebars)$/i, '');
  const componentsMarker = '/components/';
  const markerIndex = extensionless.lastIndexOf(componentsMarker);
  if (markerIndex === -1) {
    return null;
  }

  const relativeToComponents = extensionless.slice(
    markerIndex + componentsMarker.length,
  );
  if (!relativeToComponents.includes('/partials/')) {
    return null;
  }

  return normalizePartialPath(relativeToComponents);
}

function normalizePartialPath(value: string): string | null {
  const normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment, index, parts) =>
      index === parts.length - 1 ? segment.replace(/^_/, '') : segment,
    )
    .join('/');

  return normalized.length > 0 ? normalized : null;
}

export async function extractHelpersFromFile(
  filePath: string,
  logger?: Logger,
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'].includes(ext)) {
    return [];
  }

  let fileStat: Stats;
  try {
    fileStat = await stat(filePath);
    if (fileStat.size > scanLimits.maxSourceScanBytes) {
      helperExtractionCache.set(filePath, {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        helpers: [],
      });
      logger?.info(
        `Skipping helper scan for large file ${filePath} (${fileStat.size} bytes)`,
      );
      if (refreshStats) {
        refreshStats.filesSkippedTooLarge += 1;
      }
      return [];
    }
  } catch (error) {
    logger?.warn(
      `Failed to stat file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  const cached = helperExtractionCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    logger?.info(`Using cached helper scan for ${filePath}`);
    return [...cached.helpers];
  }

  const content = await readSourceFile(
    filePath,
    logger,
    'helper scan',
    scanLimits,
    refreshStats,
  );
  if (content === null) {
    return [];
  }

  const helpers = new Set<string>();
  const patterns = [
    /registerHelper\(\s*['"]([A-Za-z0-9_./-]+)['"]/g,
    /helper\(\s*['"]([A-Za-z0-9_./-]+)['"]/g,
    /export\s+const\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:helper|\()/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      helpers.add(match[1]);
    }
  }

  const extractedHelpers = Array.from(helpers);
  helperExtractionCache.set(filePath, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    helpers: extractedHelpers,
  });

  return extractedHelpers;
}

export async function extractRegisteredPartialsFromFile(
  filePath: string,
  logger?: Logger,
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'].includes(ext)) {
    return [];
  }

  const content = await readSourceFile(
    filePath,
    logger,
    'registered partial scan',
    scanLimits,
    refreshStats,
  );
  if (content === null) {
    return [];
  }

  const partials = new Set<string>();
  const directRegistrationPatterns = [
    /registerPartial\(\s*['"]([A-Za-z0-9_./-]+)['"]/g,
    /Handlebars\.registerPartial\(\s*['"]([A-Za-z0-9_./-]+)['"]/g,
  ];
  for (const pattern of directRegistrationPatterns) {
    for (const match of content.matchAll(pattern)) {
      partials.add(match[1]);
    }
  }

  for (const objectMatch of content.matchAll(
    /registerPartial\(\s*\{([\s\S]*?)\}\s*\)/g,
  )) {
    const objectBody = objectMatch[1] ?? '';
    for (const propertyMatch of objectBody.matchAll(
      /(?:['"]([A-Za-z0-9_./-]+)['"]|([A-Za-z_][A-Za-z0-9_./-]*))\s*:/g,
    )) {
      partials.add(propertyMatch[1] ?? propertyMatch[2]);
    }
  }

  return Array.from(partials);
}

export async function refreshWorkspaceIndex(
  workspaceIndex: WorkspaceIndex,
  workspaceRoots: string[],
  settings: Pick<
    ServerSettings,
    'partialRoots' | 'maxSourceScanBytes' | 'maxWorkspaceFiles' | 'maxWalkDepth'
  > = defaultSettings,
  logger?: Logger,
): Promise<WorkspaceIndexRefreshStats> {
  const start = Date.now();
  const scanLimits: ScanLimits = {
    maxSourceScanBytes: settings.maxSourceScanBytes,
    maxWorkspaceFiles: settings.maxWorkspaceFiles,
    maxWalkDepth: settings.maxWalkDepth,
  };
  const refreshStats: WorkspaceIndexRefreshStats = {
    workspaceRoots: workspaceRoots.length,
    filesDiscovered: 0,
    templateFiles: 0,
    sourceFilesRead: 0,
    filesSkippedTooLarge: 0,
    scanStoppedDueToLimits: false,
    durationMs: 0,
    limits: { ...scanLimits },
  };

  helperExtractionCache.clear();
  gitignorePatternCache.clear();

  workspaceIndex.helpers.clear();
  workspaceIndex.partials.clear();
  workspaceIndex.partialFilesByName.clear();
  workspaceIndex.partialSourcesByName.clear();

  for (const helper of defaultSettings.helpers) {
    workspaceIndex.helpers.add(helper);
  }
  for (const partial of defaultSettings.partials) {
    workspaceIndex.partials.add(partial);
  }

  for (const root of workspaceRoots) {
    const files = await walkFiles(root, logger, [], scanLimits, refreshStats);
    const templateFiles: string[] = [];
    const detectedPartialRoots = new Set<string>();
    const detectedPartialsDirRoots = new Set<string>();

    for (const filePath of files) {
      if (/\.(hbs|handlebars)$/i.test(filePath)) {
        templateFiles.push(filePath);
        refreshStats.templateFiles += 1;
      }

      for (const helper of await extractHelpersFromFile(
        filePath,
        logger,
        scanLimits,
        refreshStats,
      )) {
        workspaceIndex.helpers.add(helper);
      }

      for (const partial of await extractRegisteredPartialsFromFile(
        filePath,
        logger,
        scanLimits,
        refreshStats,
      )) {
        addIndexedPartial(workspaceIndex, partial, filePath, {
          kind: 'registered',
          filePath,
          detail: 'registerPartial(...)',
        });
      }

      for (const partialRoot of await extractPartialRootsFromFile(
        filePath,
        root,
        logger,
        scanLimits,
        refreshStats,
      )) {
        detectedPartialRoots.add(partialRoot);
        detectedPartialsDirRoots.add(partialRoot);
      }
    }

    const resolvedPartialRoots = new Set<string>([
      ...resolveConfiguredPartialRoots(root, settings.partialRoots),
      ...detectedPartialRoots,
    ]);

    for (const filePath of templateFiles) {
      for (const partial of inferPartialNames(filePath, root)) {
        addIndexedPartial(workspaceIndex, partial, filePath, {
          kind: 'heuristic',
          filePath,
        });
      }

      for (const partialRoot of resolvedPartialRoots) {
        const relativePartial = inferPartialNameFromRoot(filePath, partialRoot);
        if (relativePartial) {
          addIndexedPartial(workspaceIndex, relativePartial, filePath, {
            kind: detectedPartialsDirRoots.has(partialRoot)
              ? 'detected-partialsDir'
              : 'partial-root',
            filePath,
            rootPath: partialRoot,
          });
        }
      }
    }
  }

  refreshStats.durationMs = Date.now() - start;
  logger?.info(
    `Workspace index refreshed: roots=${refreshStats.workspaceRoots}, files=${refreshStats.filesDiscovered}, templates=${refreshStats.templateFiles}, sourceReads=${refreshStats.sourceFilesRead}, skippedLarge=${refreshStats.filesSkippedTooLarge}, limited=${refreshStats.scanStoppedDueToLimits}, durationMs=${refreshStats.durationMs}`,
  );

  return refreshStats;
}

function addIndexedPartial(
  workspaceIndex: WorkspaceIndex,
  partial: string,
  filePath: string,
  source: IndexedPartialSource,
): void {
  workspaceIndex.partials.add(partial);
  const existing = workspaceIndex.partialFilesByName.get(partial) ?? [];
  if (!existing.includes(filePath)) {
    existing.push(filePath);
    workspaceIndex.partialFilesByName.set(partial, existing);
  }

  const sources = workspaceIndex.partialSourcesByName.get(partial) ?? [];
  if (
    !sources.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(source),
    )
  ) {
    sources.push(source);
    workspaceIndex.partialSourcesByName.set(partial, sources);
  }
}

function inferPartialNameFromRoot(
  filePath: string,
  partialRoot: string,
): string | null {
  const normalizedRoot = partialRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (
    normalizedFile !== normalizedRoot &&
    !normalizedFile.startsWith(`${normalizedRoot}/`)
  ) {
    return null;
  }

  const relative = path
    .relative(partialRoot, filePath)
    .replace(/\\/g, '/')
    .replace(/\.(?:hbs|handlebars)$/i, '');
  return normalizePartialPath(relative);
}

function resolveConfiguredPartialRoots(
  workspaceRoot: string,
  configuredPartialRoots: string[],
): string[] {
  return configuredPartialRoots
    .map((partialRoot) =>
      path.isAbsolute(partialRoot)
        ? partialRoot
        : path.resolve(workspaceRoot, partialRoot),
    )
    .map((partialRoot) => partialRoot.replace(/\\/g, '/'));
}

async function extractPartialRootsFromFile(
  filePath: string,
  workspaceRoot: string,
  logger?: Logger,
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts'].includes(ext)) {
    return [];
  }

  const content = await readSourceFile(
    filePath,
    logger,
    'partial root scan',
    scanLimits,
    refreshStats,
  );
  if (content === null) {
    return [];
  }

  const roots = new Set<string>();
  const partialsDirPattern =
    /partialsDir\s*:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/g;
  for (const match of content.matchAll(partialsDirPattern)) {
    const value = match[1] ?? '';
    for (const stringMatch of value.matchAll(/['"`]([^'"`]+)['"`]/g)) {
      const partialRoot = stringMatch[1]?.trim();
      if (!partialRoot) {
        continue;
      }
      roots.add(
        path.isAbsolute(partialRoot)
          ? partialRoot.replace(/\\/g, '/')
          : path.resolve(workspaceRoot, partialRoot).replace(/\\/g, '/'),
      );
    }
  }

  return Array.from(roots);
}

async function readSourceFile(
  filePath: string,
  logger: Logger | undefined,
  purpose: string,
  scanLimits: ScanLimits = DEFAULT_SCAN_LIMITS,
  refreshStats?: WorkspaceIndexRefreshStats,
): Promise<string | null> {
  let fileStat: Stats;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    logger?.warn(
      `Failed to stat file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (fileStat.size > scanLimits.maxSourceScanBytes) {
    logger?.info(
      `Skipping ${purpose} for large file ${filePath} (${fileStat.size} bytes)`,
    );
    if (refreshStats) {
      refreshStats.filesSkippedTooLarge += 1;
    }
    return null;
  }

  try {
    const content = await readFile(filePath, 'utf8');
    if (refreshStats) {
      refreshStats.sourceFilesRead += 1;
    }
    return content;
  } catch (error) {
    logger?.warn(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function normalizeSettings(
  settings: Partial<ServerSettings> | undefined,
  workspaceIndex: WorkspaceIndex,
): ServerSettings {
  const merged = {
    ...defaultSettings,
    ...(settings ?? {}),
  };

  const indexedHelpers = merged.indexWorkspaceSymbols
    ? Array.from(workspaceIndex.helpers)
    : [];
  const indexedPartials = merged.indexWorkspaceSymbols
    ? Array.from(workspaceIndex.partials)
    : [];

  return {
    ...merged,
    helpers: uniqueStrings([
      ...indexedHelpers,
      ...(Array.isArray(merged.helpers)
        ? merged.helpers
        : defaultSettings.helpers),
    ]),
    partials: uniqueStrings([
      ...indexedPartials,
      ...(Array.isArray(merged.partials)
        ? merged.partials
        : defaultSettings.partials),
    ]),
    partialRoots: uniqueStrings(
      Array.isArray(merged.partialRoots)
        ? merged.partialRoots
        : defaultSettings.partialRoots,
    ),
    indexWorkspaceSymbols: merged.indexWorkspaceSymbols !== false,
    exposeAbsolutePathsInIndex: merged.exposeAbsolutePathsInIndex === true,
    maxSourceScanBytes: Math.max(
      Number.isFinite(merged.maxSourceScanBytes)
        ? Math.floor(merged.maxSourceScanBytes)
        : defaultSettings.maxSourceScanBytes,
      1,
    ),
    maxWorkspaceFiles: Math.max(
      Number.isFinite(merged.maxWorkspaceFiles)
        ? Math.floor(merged.maxWorkspaceFiles)
        : defaultSettings.maxWorkspaceFiles,
      1,
    ),
    maxWalkDepth: Math.max(
      Number.isFinite(merged.maxWalkDepth)
        ? Math.floor(merged.maxWalkDepth)
        : defaultSettings.maxWalkDepth,
      1,
    ),
    maxFullAnalysisChars: Math.max(
      Number.isFinite(merged.maxFullAnalysisChars)
        ? Math.floor(merged.maxFullAnalysisChars)
        : defaultSettings.maxFullAnalysisChars,
      1,
    ),
  };
}
