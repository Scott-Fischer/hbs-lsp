import type { Range } from 'vscode-languageserver/node.js';

export type ServerSettings = {
  indentSize: number;
  enableDiagnostics: boolean;
  enableFormatting: boolean;
  helpers: string[];
  partials: string[];
  partialRoots: string[];
  indexWorkspaceSymbols: boolean;
};

export type AstSummaryNode = {
  kind: 'mustache' | 'block' | 'partial' | 'comment';
  name: string;
  range: Range;
};

export type AstSummary = {
  uri: string;
  nodes: AstSummaryNode[];
  blockStackBalanced: boolean;
  analysisSource: 'glimmer' | 'fallback';
};

export type IndexedPartialSource = {
  kind: 'heuristic' | 'partial-root' | 'detected-partialsDir' | 'registered';
  filePath?: string;
  rootPath?: string;
  detail?: string;
};

export type WorkspaceIndex = {
  helpers: Set<string>;
  partials: Set<string>;
  partialFilesByName: Map<string, string[]>;
  partialSourcesByName: Map<string, IndexedPartialSource[]>;
};

export type BlockToken = {
  type: 'open' | 'close' | 'else';
  name: string;
  index: number;
  length: number;
};

export type BlockIssue =
  | { type: 'stray-else'; token: BlockToken }
  | { type: 'stray-close'; token: BlockToken }
  | { type: 'mismatch-close'; token: BlockToken; expected: string }
  | { type: 'unclosed-open'; token: BlockToken };

export type BlockAnalysis = {
  issues: BlockIssue[];
  openStack: BlockToken[];
};

export type HandlebarsToken = {
  type:
    | 'comment'
    | 'block-open'
    | 'block-close'
    | 'else'
    | 'partial'
    | 'mustache';
  name: string | null;
  index: number;
  length: number;
  raw: string;
};

export type ParseErrorInfo = {
  message: string;
  location?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
};

export type DelimiterDiagnostic = {
  kind: 'unmatched-open' | 'unmatched-close';
  index: number;
  length: number;
};

export type DocumentAnalysis = {
  tokens: HandlebarsToken[];
  blockAnalysis: BlockAnalysis;
  glimmerAst: import('@glimmer/syntax').ASTv1.Template | null;
  usedSanitization: boolean;
  parseErrors: ParseErrorInfo[];
  delimiterDiagnostics: DelimiterDiagnostic[];
};

export const defaultSettings: ServerSettings = {
  indentSize: 2,
  enableDiagnostics: true,
  enableFormatting: true,
  indexWorkspaceSymbols: true,
  helpers: ['if', 'unless', 'each', 'with', 'let', 'log', 'lookup'],
  partials: [],
  partialRoots: [],
};
