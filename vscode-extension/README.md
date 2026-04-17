# hbs-lsp for VS Code

`hbs-lsp` brings Handlebars language server support to VS Code for non-Ember projects such as Express, Fastify, Eleventy, and custom Node applications.

## Features

- syntax diagnostics
- completions for common Handlebars patterns
- hover information for helpers and partials
- formatting
- semantic tokens
- document symbols and folding ranges
- workspace indexing for helpers and partials

## Getting started

1. Install the extension.
2. Open a workspace containing `.hbs` or `.handlebars` files.
3. Open a Handlebars file to start the language server.

The extension bundles the language server, so no separate global `npm install` is required.

## Commands

The extension contributes these commands:

- `hbs-lsp: Show Index`
- `hbs-lsp: Reindex Workspace`
- `hbs-lsp: Show Output`
- `hbs-lsp: Restart Server`

## Configuration

Settings are available under the `handlebars.*` namespace in VS Code settings.

Common settings include:

- `handlebars.indentSize`
- `handlebars.enableDiagnostics`
- `handlebars.enableFormatting`
- `handlebars.indexWorkspaceSymbols`
- `handlebars.helpers`
- `handlebars.partials`
- `handlebars.partialRoots`

## Notes

- Workspace indexing runs on startup and when you manually reindex.
- The server is bundled inside the extension package.

## Troubleshooting

If the extension is not behaving as expected:

- run `hbs-lsp: Show Output` to inspect server logs and request errors
- run `hbs-lsp: Restart Server` after changing settings or if the server seems stuck
- run `hbs-lsp: Reindex Workspace` if helpers or partials are missing
- make sure your files use the `.hbs` or `.handlebars` extension

See [CHANGELOG.md](./CHANGELOG.md) for release history.
