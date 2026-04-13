import { describe, expect, it } from 'vitest';
import { TextDocuments } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createSessionHelpers, createSessionState } from '../session.js';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createSessionHelpers', () => {
  it('coalesces concurrent workspace refresh requests', async () => {
    const state = createSessionState();
    state.hasConfigurationCapability = true;

    const documents = new TextDocuments(TextDocument);
    const calls: Array<{ resolve: () => void }> = [];
    let getConfigurationCount = 0;

    const connection = {
      workspace: {
        getConfiguration: () => {
          getConfigurationCount += 1;
          const pending = deferred<void>();
          calls.push({ resolve: () => pending.resolve() });
          return pending.promise.then(() => ({
            helpers: [],
            partials: [],
            partialRoots: [],
          }));
        },
      },
      sendDiagnostics: () => undefined,
    };

    const helpers = createSessionHelpers(
      connection as never,
      documents,
      state,
      {
        info: () => undefined,
        warn: () => undefined,
      },
    );

    const first = helpers.doRefreshWorkspaceIndex();
    const second = helpers.doRefreshWorkspaceIndex();
    const third = helpers.doRefreshWorkspaceIndex();

    await flushMicrotasks();
    expect(getConfigurationCount).toBe(1);

    calls[0]?.resolve();
    await flushMicrotasks();
    expect(getConfigurationCount).toBe(2);

    calls[1]?.resolve();
    await Promise.all([first, second, third]);
    expect(getConfigurationCount).toBe(2);
  });
});
