import { MarkupKind } from 'vscode-languageserver/node.js';
import {
  extractInlinePartialDefinitions,
  tokenizeHandlebars,
} from '../analysis.js';
import { offsetRange, readTokenAt } from '../utilities.js';
import type { HandlerContext } from './types.js';

export function registerHoverHandler({
  connection,
  documents,
  getDocumentSettings,
  workspaceIndex,
}: HandlerContext): void {
  connection.onHover(async ({ textDocument, position }) => {
    const document = documents.get(textDocument.uri);
    if (!document) {
      return null;
    }

    const offset = document.offsetAt(position);
    const text = document.getText();
    const word = readTokenAt(text, offset);
    if (!word) {
      return null;
    }

    const settings = await getDocumentSettings(textDocument.uri);
    const inlinePartial = extractInlinePartialDefinitions(text).find(
      (candidate) =>
        offset >= candidate.nameIndex &&
        offset <= candidate.nameIndex + candidate.nameLength,
    );
    const token = tokenizeHandlebars(text).find(
      (candidate) =>
        offset >= candidate.index &&
        offset <= candidate.index + candidate.length &&
        candidate.name === word,
    );

    if (settings.helpers.includes(word) || workspaceIndex.helpers.has(word)) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Helper** \`${word}\``,
        },
      };
    }

    if (inlinePartial) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Inline partial** \`${inlinePartial.name}\``,
        },
        range: offsetRange(
          document,
          inlinePartial.nameIndex,
          inlinePartial.nameLength,
        ),
      };
    }

    if (settings.partials.includes(word) || workspaceIndex.partials.has(word)) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Partial** \`${word}\``,
        },
      };
    }

    if (
      token?.type === 'partial' &&
      extractInlinePartialDefinitions(text).some(
        (candidate) => candidate.name === word,
      )
    ) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Inline partial invocation** \`${word}\``,
        },
      };
    }

    if (token?.type === 'partial') {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Partial invocation** \`${word}\``,
        },
      };
    }

    if (token?.type === 'block-open' || token?.type === 'mustache') {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Handlebars expression** \`${word}\``,
        },
      };
    }

    if (token?.type === 'block-close') {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**Closing block tag** \`${word}\``,
        },
      };
    }

    return null;
  });
}
