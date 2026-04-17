# Changelog

All notable changes to the `hbs-lsp` VS Code extension will be documented in this file.

## [0.1.5] - 2026-04-16

### Fixed
- Fixed helper indexing for aliased helper bag imports used in Express Handlebars config.
- Fixed false positives where helper-like patterns in comments, strings, or commented-out spreads could be indexed.
- Fixed reindex behavior when imported or spread-based helper source modules change or are deleted.
- Improved reliability of helper definition targeting for indexed helpers.

### Changed
- Expanded regression coverage for helper indexing, definition resolution, reindex behavior, and session settings flow.

## [0.1.4] - 2026-04-16

### Added
- Added helper go-to-definition support for indexed helpers in Handlebars templates.
- Added helper indexing support for Express Handlebars helper bags, including common CommonJS exports and imported helper modules.
- Added helper indexing support for common spread-based helper composition patterns.

### Changed
- Improved helper definition resolution so indexed helpers jump to their source modules more reliably in real Express Handlebars projects.

## [0.1.3] - 2026-04-16

### Added
- Added `Show Output` and `Restart Server` commands for easier troubleshooting in VS Code.
- Added a troubleshooting section to the VS Code extension README.

### Changed
- Improved command metadata shown in the VS Code command palette.

## [0.1.2] - 2026-04-16

### Changed
- Bundled the language server with `esbuild` inside the extension package, removing the remaining runtime `node_modules` payload from the VSIX.
- Switched the extension build to typecheck the root project and bundle both client and server artifacts directly for release packaging.
- Clarified the bundled server `--version` output to include the VS Code extension version.

## [0.1.1] - 2026-04-16

### Added
- Published VS Code Marketplace extension metadata, icon, packaging scripts, and CI packaging workflow.
- Bundled language server inside the extension package so users do not need a separate global `hbs-lsp` install.

### Changed
- Bundled the VS Code client with `esbuild` to reduce the VSIX size and dependency footprint.
- Updated local development and packaging documentation for the published extension flow.

## [0.1.0] - 2026-04-16

### Added
- Initial VS Code extension wrapper for the `hbs-lsp` Handlebars language server.
