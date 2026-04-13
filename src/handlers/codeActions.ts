import {
  CodeAction,
  CodeActionKind,
  Range,
  TextEdit,
} from 'vscode-languageserver/node.js';
import { analyzeDocument } from '../analysis.js';
import { formatHandlebars } from '../formatting.js';
import { offsetRange } from '../utilities.js';
import type { HandlerContext } from './types.js';

export function registerCodeActionsHandler({
  connection,
  documents,
  getDocumentSettings,
}: HandlerContext): void {
  connection.onCodeAction(async ({ textDocument }): Promise<CodeAction[]> => {
    const document = documents.get(textDocument.uri);
    if (!document) {
      return [];
    }

    const settings = await getDocumentSettings(textDocument.uri);
    const text = document.getText();
    const analysis = analyzeDocument(text).blockAnalysis;
    const actions: CodeAction[] = [];

    for (const issue of analysis.issues) {
      if (issue.type === 'mismatch-close') {
        const match = text
          .slice(issue.token.index, issue.token.index + issue.token.length)
          .match(/^{{\/([^\s}]+)(\s*}})$/);
        if (match) {
          actions.push(
            CodeAction.create(
              `Rename closing tag to {{/${issue.expected}}}`,
              {
                changes: {
                  [textDocument.uri]: [
                    TextEdit.replace(
                      offsetRange(
                        document,
                        issue.token.index,
                        issue.token.length,
                      ),
                      `{{/${issue.expected}${match[2]}`,
                    ),
                  ],
                },
              },
              CodeActionKind.QuickFix,
            ),
          );
        }
        continue;
      }

      if (issue.type === 'stray-close' || issue.type === 'stray-else') {
        actions.push(
          CodeAction.create(
            `Remove ${issue.type === 'stray-close' ? 'unmatched closing tag' : 'stray else block'}`,
            {
              changes: {
                [textDocument.uri]: [
                  TextEdit.replace(
                    offsetRange(
                      document,
                      issue.token.index,
                      issue.token.length,
                    ),
                    '',
                  ),
                ],
              },
            },
            CodeActionKind.QuickFix,
          ),
        );
      }
    }

    const missingClosers = analysis.openStack
      .slice()
      .reverse()
      .map((token, reverseIndex) => {
        const depth = analysis.openStack.length - reverseIndex - 1;
        return `${' '.repeat(depth * settings.indentSize)}{{/${token.name}}}`;
      })
      .join('\n');

    if (missingClosers.length > 0) {
      actions.push(
        CodeAction.create(
          'Append missing closing block tags',
          {
            changes: {
              [textDocument.uri]: [
                TextEdit.insert(
                  document.positionAt(text.length),
                  `${text.endsWith('\n') ? '' : '\n'}${missingClosers}\n`,
                ),
              ],
            },
          },
          CodeActionKind.QuickFix,
        ),
      );
    }

    if (settings.enableFormatting) {
      const formatted = formatHandlebars(text, settings.indentSize);
      if (formatted !== text) {
        actions.push(
          CodeAction.create(
            'Reindent Handlebars template',
            {
              changes: {
                [textDocument.uri]: [
                  TextEdit.replace(
                    Range.create(
                      document.positionAt(0),
                      document.positionAt(text.length),
                    ),
                    formatted,
                  ),
                ],
              },
            },
            CodeActionKind.SourceFixAll,
          ),
        );
      }
    }

    return actions;
  });
}
