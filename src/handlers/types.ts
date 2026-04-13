import type { Connection, TextDocuments } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ServerSettings, WorkspaceIndex } from '../types.js';

export type HandlerContext = {
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  getDocumentSettings: (resource: string) => Thenable<ServerSettings>;
  workspaceIndex: WorkspaceIndex;
};
