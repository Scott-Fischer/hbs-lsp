# Changelog

All notable changes to hbs-lsp will be documented in this file.

## 0.1.0 — 2026-04-10

Initial release.

### Features

- **Syntax diagnostics** — powered by `@glimmer/syntax` with extra validation for unclosed/mismatched block tags and unbalanced delimiters; falls back to token-based analysis when Glimmer cannot parse the template
- **Completions** — snippets for `{{#if}}`, `{{#each}}`, `{{#with}}`, `{{> partial}}`, plus configured and workspace-indexed helpers and partials
- **Hover** — documentation lookup for configured helpers and partials
- **Formatting** — AST-aware template formatting for nested blocks and `else` chains, with a regex fallback for malformed templates
- **Semantic tokens** — syntax highlighting for comments, helpers, partials, variables, strings, and Handlebars operators
- **Workspace indexing** — discovers helpers from `registerHelper()` / `helper()` / `export const … = helper(` patterns in JS/TS files and partials from `.hbs`/`.handlebars` files; honors common ignored directories and root-level `.gitignore` rules
- **Document symbols** — hierarchical outlines for block helpers and nested template sections
- **Folding ranges** — collapsible regions for matched block sections
- **Code actions / quick fixes** — auto-fix missing closing tags, rename mismatched closing tags, remove stray `else`/closing tags, reindent templates
- **Custom requests** — `handlebars/ast`, `handlebars/index`, `handlebars/reindex` for programmatic access by editors and coding agents

### Packaging & tooling

- npm package excludes compiled test files (`dist/__tests__/`) via a dedicated `tsconfig.build.json`
- CI tests against Node 20 and Node 22; `@types/node` pinned to `@22` to match the minimum engine
- `@vitest/coverage-v8` added; `npm run test:coverage` produces a V8 coverage report
- Log levels corrected: info messages use `connection.console.log`, warnings use `connection.console.warn`
- `--stdio` flag accepted by the CLI for LSP client compatibility
- Workspace index caches (`helperExtractionCache`, `gitignorePatternCache`) cleared at the start of each reindex cycle to prevent unbounded growth in long-running sessions
