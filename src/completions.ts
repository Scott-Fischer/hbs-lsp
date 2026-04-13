import {
  type CompletionItem,
  CompletionItemKind,
  Position,
} from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { extractInlinePartialDefinitions } from './analysis.js';
import type { ServerSettings } from './types.js';

export function getCompletions(
  document: TextDocument,
  position: Position,
  settings: ServerSettings,
): CompletionItem[] {
  const linePrefix = document.getText({
    start: Position.create(position.line, 0),
    end: position,
  });

  const items: CompletionItem[] = [
    {
      label: '{{}}',
      kind: CompletionItemKind.Snippet,
      insertText: '{{$1}}',
      insertTextFormat: 2,
      detail: 'Mustache expression',
    },
    {
      label: '{{#if}}',
      kind: CompletionItemKind.Snippet,
      insertText: '{{#if $1}}\n$0\n{{/if}}',
      insertTextFormat: 2,
      detail: 'if block',
    },
    {
      label: '{{#each}}',
      kind: CompletionItemKind.Snippet,
      insertText: '{{#each $1 as |item|}}\n$0\n{{/each}}',
      insertTextFormat: 2,
      detail: 'each block',
    },
    {
      label: '{{#with}}',
      kind: CompletionItemKind.Snippet,
      insertText: '{{#with $1 as |value|}}\n$0\n{{/with}}',
      insertTextFormat: 2,
      detail: 'with block',
    },
    {
      label: '{{> partial}}',
      kind: CompletionItemKind.Snippet,
      insertText: '{{> $1}}',
      insertTextFormat: 2,
      detail: 'Partial include',
    },
  ];

  for (const helper of settings.helpers) {
    items.push({
      label: helper,
      kind: CompletionItemKind.Function,
      insertText: helper,
      detail: 'Configured helper',
    });
  }

  for (const partial of settings.partials) {
    items.push({
      label: partial,
      kind: CompletionItemKind.Module,
      insertText: partial,
      detail: 'Configured partial',
    });
  }

  for (const partial of extractInlinePartialDefinitions(document.getText())) {
    items.push({
      label: partial.name,
      kind: CompletionItemKind.Module,
      insertText: partial.name,
      detail: 'Inline partial in document',
    });
  }

  const dedupedItems = items.filter(
    (item, index, source) =>
      source.findIndex((candidate) => candidate.label === item.label) === index,
  );

  if (/{{[#/>]?$/.test(linePrefix.trimStart())) {
    return dedupedItems;
  }

  return dedupedItems.filter((item) => !item.label.startsWith('{{#'));
}
