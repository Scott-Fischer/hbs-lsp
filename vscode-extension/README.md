# hbs-lsp VS Code extension

VS Code extension for the `hbs-lsp` Handlebars language server.

## Features

- Handlebars diagnostics
- completions, hover, document symbols, and folding
- formatting
- semantic tokens
- workspace indexing for helpers and partials

## Development

```bash
npm install
cd vscode-extension
npm install
npm run build
```

The extension build compiles the root language server, bundles it into `vscode-extension/server/`, and compiles the VS Code client into `vscode-extension/dist/`.

To run the extension locally, open `vscode-extension/` in VS Code and run **Run Extension**.

## Packaging

```bash
npm run package
```

That creates a `.vsix` file in `vscode-extension/`.

## Publishing

Before publishing, update the `publisher` field in `vscode-extension/package.json`.

### VS Code Marketplace

```bash
npm run publish:vsce
```

Requires a `VSCE_PAT` or an existing `vsce` login.

### Open VSX

```bash
npm run publish:ovsx
```

Requires an `OVSX_PAT` or an existing `ovsx` login.
