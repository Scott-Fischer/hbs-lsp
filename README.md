# hbs-lsp

A lightweight Language Server Protocol server for Handlebars templates.

Designed for coding agents, editors, and automation tools. Communicates over stdio.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

## Why hbs-lsp?

Handlebars has ~12M weekly npm downloads but zero standalone LSP support outside the Ember ecosystem. If you use Handlebars with Express, Fastify, or any non-Ember setup, this is the only LSP that understands your templates.

## Features

- **Syntax diagnostics** — powered by `@glimmer/syntax` with extra validation for unclosed/mismatched block tags and unbalanced delimiters
- **Completions** — snippets for `{{#if}}`, `{{#each}}`, `{{#with}}`, `{{> partial}}`, plus configured helpers and partials
- **Hover** — documentation for configured helpers and partials
- **Formatting** — AST-aware template formatting for nested blocks and `else` chains, with a regex fallback for malformed templates
- **Semantic tokens** — syntax highlighting for comments, helpers, partials, variables, strings, and Handlebars operators
- **Workspace indexing** — discovers helpers from `registerHelper()` calls in JS/TS files and partials from `.hbs`/`.handlebars` files, with common generated/dependency directories and simple root-level `.gitignore` rules honored during scanning
- **Document symbols** — hierarchical outlines for block helpers and nested sections
- **Folding ranges** — collapsible regions for matched block sections
- **Quick fixes** — auto-fix missing closing tags, rename mismatched closing tags, remove stray `else`/closing tags, reindent templates
- **Custom requests** — `handlebars/ast`, `handlebars/index`, `handlebars/reindex` for programmatic access

## Install

### From npm

```bash
npm install -g hbs-lsp
```

The published package ships the built `dist/` output plus the README and license. Publishing runs lint, tests, and a fresh build before upload.

### From source

```bash
git clone https://github.com/Scott-Fischer/hbs-lsp.git
cd hbs-lsp
npm install
npm run build
```

## CLI

```bash
hbs-lsp            # Start the LSP server (communicates over stdio)
hbs-lsp --help     # Show help
hbs-lsp --version  # Show version
```

## Editor setup

### Neovim (nvim-lspconfig)

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.hbs_lsp then
  configs.hbs_lsp = {
    default_config = {
      cmd = { 'hbs-lsp' },
      filetypes = { 'handlebars', 'html.handlebars' },
      root_dir = lspconfig.util.root_pattern('package.json', '.git'),
      settings = {
        handlebars = {
          indentSize = 2,
          enableDiagnostics = true,
          enableFormatting = true,
          indexWorkspaceSymbols = true,
        },
      },
    },
  }
end

lspconfig.hbs_lsp.setup({})
```

### VS Code (generic LSP client)

Use an extension like [vscode-glspc](https://marketplace.visualstudio.com/items?itemName=AZMCode.glspc) or any generic LSP client extension:

```json
{
  "glspc.languageId": "handlebars",
  "glspc.serverCommand": "hbs-lsp",
  "glspc.serverTransport": "stdio"
}
```

### VS Code (local wrapper extension in this repo)

This repository also includes a minimal VS Code client wrapper in [`vscode-extension/`](vscode-extension).

```bash
npm install
npm run build
cd vscode-extension
npm install
npm run build
code .
```

Then open the `vscode-extension/` folder in VS Code and run the **Run Extension** launch configuration (or press `F5` after adding a standard extension-host launch config). The wrapper starts `../dist/server.js` over stdio and forwards the `handlebars.*` workspace settings to the server.

### Helix

Add to `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "handlebars"
language-servers = ["hbs-lsp"]

[language-server.hbs-lsp]
command = "hbs-lsp"
```

### Sublime Text (LSP package)

Add to LSP settings:

```json
{
  "clients": {
    "hbs-lsp": {
      "command": ["hbs-lsp"],
      "selector": "text.html.handlebars",
      "initializationOptions": {
        "indentSize": 2,
        "enableDiagnostics": true,
        "enableFormatting": true,
        "indexWorkspaceSymbols": true
      }
    }
  }
}
```

### Emacs (lsp-mode)

```elisp
(with-eval-after-load 'lsp-mode
  (add-to-list 'lsp-language-id-configuration '(handlebars-mode . "handlebars"))
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection '("hbs-lsp"))
    :activation-fn (lsp-activate-on "handlebars")
    :server-id 'hbs-lsp)))
```

## Configuration

Settings can be provided via `initializationOptions` at startup or through the `handlebars` workspace configuration section.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `indentSize` | `number` | `2` | Spaces per indent level for formatting |
| `enableDiagnostics` | `boolean` | `true` | Enable syntax and block validation |
| `enableFormatting` | `boolean` | `true` | Enable document formatting |
| `indexWorkspaceSymbols` | `boolean` | `true` | Scan workspace for helpers and partials |
| `helpers` | `string[]` | `["if", "unless", "each", "with", "let", "log", "lookup"]` | Known helper names (merged with discovered helpers) |
| `partials` | `string[]` | `[]` | Known partial names (merged with discovered partials) |
| `partialRoots` | `string[]` | `[]` | Directories to treat as Handlebars partial roots, resolved relative to the workspace when not absolute |

### Initialization options

```json
{
  "initializationOptions": {
    "indentSize": 2,
    "enableDiagnostics": true,
    "enableFormatting": true,
    "indexWorkspaceSymbols": true,
    "helpers": ["if", "each", "with", "helperA"],
    "partials": ["foo", "bar"],
    "partialRoots": ["./partials", "./components"]
  }
}
```

### Workspace configuration

The server reads the `handlebars` section when the client supports `workspace/configuration`:

```json
{
  "handlebars": {
    "indentSize": 4,
    "helpers": ["helperA", "helperB"],
    "partialRoots": ["./partials", "./components"]
  }
}
```

## Glimmer compatibility and fallback behavior

`hbs-lsp` uses `@glimmer/syntax` where possible, but Glimmer does not accept every Handlebars pattern that appears in real templates. In particular, block helpers inside HTML/component tag and property contexts can be rejected even though they are useful in practice.

To stay usable on those templates, the server follows a hybrid strategy:

- use Glimmer-backed analysis when parsing succeeds
- sanitize known Glimmer-problematic block-helper-in-tag contexts before parsing
- fall back to shared token/block analysis when Glimmer still cannot parse the document

Currently, the project intentionally supports these Glimmer-problematic patterns on a best-effort basis:

- block helpers inside quoted HTML attributes
- block helpers inside unquoted tag/property positions
- nested block helpers inside those tag/attribute contexts
- `{{else}}` and `{{else if ...}}` in those contexts
- whitespace-control forms like `{{~#if}}` and `{{~/if~}}`
- inline partial/decorator blocks such as `{{#*inline "name"}}`
- partial blocks such as `{{#> layout}} ... {{/layout}}`
- bracket-path expressions such as `foo[bar-baz]`
- mustache-driven dynamic tag names such as `<{{helper ...}}> ... </{{helper ...}}>`

This compatibility layer is designed to preserve useful diagnostics, formatting fallback, symbols, folding, semantic tokens, and AST summaries even when Glimmer is not the final authority for a given template.

When Glimmer emits known parse errors for those unsupported-but-common patterns, `hbs-lsp` now treats them as explicit compatibility false positives and relies on its shared Handlebars token/block analysis instead of surfacing misleading diagnostics.

## Workspace indexing

When `indexWorkspaceSymbols` is enabled, the server currently uses a **startup + manual reindex** model: it scans workspace folders on initialization and when `handlebars/reindex` is requested. It does not currently watch files for automatic incremental reindexing.

The scanner skips common dependency/build directories such as `node_modules`, `.git`, `dist`, `coverage`, `.next`, `.turbo`, `.cache`, `tmp`, `temp`, `build`, and `out`. It also honors simple root-level `.gitignore` rules for ignored files/directories during workspace scans.

When `indexWorkspaceSymbols` is enabled, the server scans workspace folders for:

- **Partials** — `.hbs` and `.handlebars` files (names inferred from file paths, with special handling for `partials/`, `templates/`, and `views/` directories), plus JS/TS `registerPartial("name", ...)` and `registerPartial({ name: ... })` patterns
- **Helpers** — JS/TS files containing `registerHelper("name")`, `helper("name")`, or `export const name = helper(` patterns

Very large helper source files are skipped during scanning to keep indexing responsive, and unchanged helper files reuse cached extraction results across reindex runs.

Discovered helpers and partials are merged with any configured values and made available for completions and hover.

When `partialRoots` is configured, `hbs-lsp` also indexes template names relative to those directories. This is especially useful for setups that pass explicit `partialsDir` values such as `./partials` and `./components`.

As a convenience, `hbs-lsp` also does lightweight JS/TS detection for common runtime registration patterns such as `partialsDir: [...]` and `registerPartial(...)`. Explicit `partialRoots` remains the most reliable option when your app builds template configuration dynamically.

## Custom requests

### `handlebars/ast`

Returns a lightweight structural summary of a template. Useful for coding agents that need to understand block structure before editing. The response also reports whether the summary came from Glimmer-backed analysis or fallback token analysis.

**Request:**

```json
{ "uri": "file:///example.hbs" }
```

**Response:**

```json
{
  "uri": "file:///example.hbs",
  "nodes": [
    {
      "kind": "block",
      "name": "if",
      "range": {
        "start": { "line": 0, "character": 0 },
        "end": { "line": 0, "character": 24 }
      }
    },
    {
      "kind": "mustache",
      "name": "title",
      "range": {
        "start": { "line": 1, "character": 2 },
        "end": { "line": 1, "character": 11 }
      }
    }
  ],
  "blockStackBalanced": true,
  "analysisSource": "glimmer"
}
```

### `handlebars/index`

Returns the currently indexed helpers, partials, and workspace roots.

### `handlebars/reindex`

Forces a workspace rescan and returns the refreshed index.

## Coding agent workflow

1. Write or modify a `.hbs` file
2. Request diagnostics via normal LSP document sync
3. Run `textDocument/formatting` to fix indentation
4. Call `handlebars/ast` to inspect block structure
5. Re-check diagnostics until the document is clean

## Architecture

The server is split into focused modules:

```
src/
├── server.ts              # CLI entry point and top-level LSP wiring
├── session.ts             # Session/configuration/workspace state helpers
├── types.ts               # Shared types and default settings
├── utilities.ts           # String/range helpers
├── analysis.ts            # Shared Handlebars token/block analysis
├── ast.ts                 # Glimmer AST traversal, sanitization, AST summaries
├── diagnostics.ts         # Syntax validation and diagnostics
├── formatting.ts          # AST-aware template formatting
├── completions.ts         # Completion item generation
├── semanticTokens.ts      # Semantic token computation
├── workspace.ts           # File discovery and helper/partial indexing
└── handlers/              # LSP request/notification handlers
```

## Development

```bash
npm install          # Install dependencies
npm run lint         # Run Biome lint checks
npm run format       # Format files with Biome
npm run build        # Compile TypeScript to dist/
npm test             # Run unit tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run dev          # Start with tsx in watch mode
```

## License

[MIT](LICENSE)
