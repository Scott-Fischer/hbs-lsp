import type { ASTv1 } from '@glimmer/syntax';
import { preprocess } from '@glimmer/syntax';
import type { TemplateNode } from './ast.js';
import { sanitizeForGlimmer, visitTemplateNodes } from './ast.js';

export function formatHandlebars(text: string, indentSize: number): string {
  try {
    const ast = preprocess(sanitizeForGlimmer(text));
    return formatHandlebarsWithAst(text, indentSize, ast);
  } catch {
    return formatHandlebarsFallback(text, indentSize);
  }
}

function formatHandlebarsWithAst(
  text: string,
  indentSize: number,
  ast: ASTv1.Template,
): string {
  const lines = text.split(/\r?\n/);
  const before = new Map<number, number>();
  const after = new Map<number, number>();

  const addBefore = (line: number, value: number) => {
    before.set(line, (before.get(line) ?? 0) + value);
  };
  const addAfter = (line: number, value: number) => {
    after.set(line, (after.get(line) ?? 0) + value);
  };

  visitTemplateNodes(ast.body as TemplateNode[], (node) => {
    if (node.type === 'BlockStatement') {
      const blockNode = node as ASTv1.BlockStatement;
      const openLine = (blockNode.loc?.start?.line ?? 1) - 1;
      const closeLine = (blockNode.loc?.end?.line ?? 1) - 1;
      addAfter(openLine, 1);
      addBefore(closeLine, 1);

      if (blockNode.inverse?.loc?.start?.line) {
        const elseLine = blockNode.inverse.loc.start.line - 1;
        addBefore(elseLine, 1);
        addAfter(elseLine, 1);
      }
    }
  });

  let indent = 0;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    indent = Math.max(indent - (before.get(i) ?? 0), 0);
    const trimmed = lines[i].trim();

    if (trimmed.length === 0) {
      out.push('');
    } else {
      out.push(`${' '.repeat(indent * indentSize)}${trimmed}`);
    }

    indent += after.get(i) ?? 0;
    indent = Math.max(indent, 0);
  }

  return out.join('\n');
}

function formatHandlebarsFallback(text: string, indentSize: number): string {
  const lines = text.split(/\r?\n/);
  let indent = 0;
  const out: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      out.push('');
      continue;
    }

    if (/^{{\/(.+)}}/.test(line) || /^{{else(?:\s+if\b.*)?}}/.test(line)) {
      indent = Math.max(indent - 1, 0);
    }

    out.push(`${' '.repeat(indent * indentSize)}${line}`);

    const opens = [...line.matchAll(/{{#([A-Za-z0-9_./-]+)[^}]*}}/g)].length;
    const closes = [...line.matchAll(/{{\/([A-Za-z0-9_./-]+)\s*}}/g)].length;
    const hasElse = /^{{else(?:\s+if\b.*)?}}/.test(line);

    indent += opens;
    indent -= closes;
    if (hasElse) {
      indent += 1;
    }
    indent = Math.max(indent, 0);
  }

  return out.join('\n');
}
