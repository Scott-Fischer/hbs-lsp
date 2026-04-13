import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  analyzeBlockStructure,
  validateHandlebarsBalance,
  validateTextDocument,
} from '../diagnostics.js';

describe('validateTextDocument', () => {
  it('does not report Glimmer false positives for block helpers inside component properties', () => {
    const input =
      '<X @y={{#if foo}}A{{else if bar}}B{{else}}C{{/if}} />';
    const document = TextDocument.create(
      'file:///example-component.hbs',
      'handlebars',
      1,
      input,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('anchors parse diagnostics using line and column embedded in the parser message', () => {
    const document = TextDocument.create(
      'file:///parse-location.hbs',
      'handlebars',
      1,
      '<div>\n<span>\n</div>',
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].range.start.line).toBeGreaterThan(0);
  });

  it('deduplicates parse diagnostics when a more specific block diagnostic exists', () => {
    const document = TextDocument.create(
      'file:///stray-else.hbs',
      'handlebars',
      1,
      '{{else}}',
    );
    const diagnostics = validateTextDocument(document, true);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('must appear inside a block');
  });

  it('does not report Glimmer false positives for inline partial blocks', () => {
    const document = TextDocument.create(
      'file:///example-inline-partial.hbs',
      'handlebars',
      1,
      `{{#*inline "example"}}
  <div data-x3="{{id}}">
    {{> partial src=(concat foo bar)}}
  </div>
{{/inline}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for partial blocks', () => {
    const document = TextDocument.create(
      'file:///example-partial-block.hbs',
      'handlebars',
      1,
      `{{#> example
  type="foo"
  value=bar
}}
  <span>{{value}}</span>
  {{> icon/example }}
{{/example}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report sanitized tag-context false positives for blocks inside tags', () => {
    const document = TextDocument.create(
      'file:///tag-context-block.hbs',
      'handlebars',
      1,
      `{{~#if value}}
  <a
    href="{{ value }}"
    class="x y"
    {{~#if (helperA value)}}
    rel="nofollow"
    {{/if~}}
  >
{{/if~}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for bracket-path expressions', () => {
    const document = TextDocument.create(
      'file:///bracket-path.hbs',
      'handlebars',
      1,
      `{{#with @root.foo[bar-baz]}}
  {{> baz this}}
{{/with}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('accepts block closes with whitespace after the slash', () => {
    const document = TextDocument.create(
      'file:///spacey-close.hbs',
      'handlebars',
      1,
      `{{#> x/y}}
  {{text}}
{{/ x/y }}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report sanitized parse noise for blocks embedded in tag attributes and tag bodies', () => {
    const document = TextDocument.create(
      'file:///tag-embedded-blocks.hbs',
      'handlebars',
      1,
      `<div class="foo{{#if (not flag)}} foo-a{{else}} foo-b{{/if}}">
  <div class="bar" style="grid-row: span {{#if data.items}}{{count data.items.length}}{{else}}2{{/if}}"
  {{#if flag}}
    {{> foo/bar/baz
      area="x"
      index=n}}
    {{/if}}
  >
    <strong>{{#if flag}}A{{else}}B{{/if}}</strong>
  </div>
</div>`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for mustaches in tag names', () => {
    const document = TextDocument.create(
      'file:///example-dynamic-tag.hbs',
      'handlebars',
      1,
      `{{#if foo}}
  <{{helperA bar 'x' 'y'}} class="z">
    {{value}}
  </{{helperA bar 'x' 'y'}}>
{{/if}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for conditional tags on the same line as block helpers', () => {
    const document = TextDocument.create(
      'file:///conditional-tag-inline.hbs',
      'handlebars',
      1,
      `{{#each items as |item|}}
  {{#if (equal item.kind 'x')}}<div class="y">{{/if}}
    {{> (partial item.kind)}}
  {{#if (equal item.kind 'x')}}</div>{{/if}}
{{/each}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report false positives for optional HTML end tags like li', () => {
    const document = TextDocument.create(
      'file:///optional-li-close.hbs',
      'handlebars',
      1,
      `<ul>
  <li>A
  <li>B</li>
</ul>`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report false positives for conditionally opened and closed anchor tags', () => {
    const document = TextDocument.create(
      'file:///example-conditional-tag.hbs',
      'handlebars',
      1,
      `{{#each items as |item|}}
  {{#if item.url}}
  <a href="{{ item.url }}">
  {{/if}}

  {{ item.label }}

  {{#if item.url}}
  </a>
  {{/if}}
{{/each}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for parent-context ../ lookups', () => {
    const document = TextDocument.create(
      'file:///example-parent-context.hbs',
      'handlebars',
      1,
      `{{#each items as |item|}}
  {{#if (equal ../type 'content')}}
    {{item.heading}}
  {{/if}}
{{/each}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report Glimmer false positives for current-context dot paths', () => {
    const document = TextDocument.create(
      'file:///example-current-context.hbs',
      'handlebars',
      1,
      `{{#with foo}}
  <div data-x4="{{toJSON (pick . (asArray 'a' 'b'))}}"></div>
{{/with}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('ignores block-like tokens that appear inside Handlebars comments', () => {
    const document = TextDocument.create(
      'file:///comment-blocks.hbs',
      'handlebars',
      1,
      `{{#unless okay}}
  {{!-- end #if example --}}
{{/unless}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report sanitized false positives for blocks and comments in quoted attribute values', () => {
    const document = TextDocument.create(
      'file:///quoted-attribute-comments.hbs',
      'handlebars',
      1,
      `<div
  data-x5="{{#if cond}}yes{{else}}no{{/if}}"
  class="{{#if flag}}a{{else}}b{{/if}}"
></div>`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report sanitized false positives for comments inside quoted attribute values', () => {
    const document = TextDocument.create(
      'file:///quoted-attribute-hbs-comment.hbs',
      'handlebars',
      1,
      `<div class="
  {{#if flag}}
    {{!-- comment inside attribute --}}
    active
  {{/if}}
"></div>`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report sanitized EOF false positives for block helpers in tags', () => {
    const document = TextDocument.create(
      'file:///tag-eof-false-positive.hbs',
      'handlebars',
      1,
      `{{#unless hidden}}
  <div
    {{#if cond}}
      data-xa7="q1"
    {{else}}
      data-xa7="q2"
    {{/if}}
  >
  </div>
{{/unless}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report xml declaration false positives in raw svg templates', () => {
    const document = TextDocument.create(
      'file:///raw-svg.hbs',
      'handlebars',
      1,
      `<?xml version="1.0" encoding="UTF-8"?>
<svg><title>Icon</title></svg>`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report false positives from script raw-text braces and nested blocks', () => {
    const document = TextDocument.create(
      'file:///raw-script-example.hbs',
      'handlebars',
      1,
      `{{#unless disabled}}
<script>
  var obj = { a: 1 }};
  {{#if post}}
    window.value = {{{toJSON meta}}};
  {{/if}}
</script>
{{/unless}}`,
    );

    const diagnostics = validateTextDocument(document, true);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report false unmatched delimiters for nested mustaches inside quoted strings', () => {
    const document = TextDocument.create(
      'file:///nested-mustache-string.hbs',
      'handlebars',
      1,
      `{{> partial alt='{{foo}} {{bar}}'}}`,
    );

    const diagnostics = validateHandlebarsBalance(document);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not treat backslash-escaped handlebars as real delimiters', () => {
    const document = TextDocument.create(
      'file:///escaped-handlebars.hbs',
      'handlebars',
      1,
      String.raw`\{{{ {{{x0}}} }}}`,
    );

    const diagnostics = validateHandlebarsBalance(document);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('validateHandlebarsBalance', () => {
  it('reports unmatched opening delimiters precisely', () => {
    const document = TextDocument.create(
      'file:///open-delimiter.hbs',
      'handlebars',
      1,
      '{{',
    );
    const diagnostics = validateHandlebarsBalance(document);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('opening delimiter');
    expect(diagnostics[0].range.start.character).toBe(0);
    expect(diagnostics[0].range.end.character).toBe(2);
  });

  it('reports unmatched closing delimiters precisely', () => {
    const document = TextDocument.create(
      'file:///close-delimiter.hbs',
      'handlebars',
      1,
      '}}',
    );
    const diagnostics = validateHandlebarsBalance(document);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('closing delimiter');
    expect(diagnostics[0].range.start.character).toBe(0);
    expect(diagnostics[0].range.end.character).toBe(2);
  });

  it('does not report balanced delimiters that belong to real Handlebars tokens', () => {
    const document = TextDocument.create(
      'file:///balanced.hbs',
      'handlebars',
      1,
      '{{name}}',
    );
    const diagnostics = validateHandlebarsBalance(document);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not report false unmatched delimiters for dynamic partial invocations', () => {
    const document = TextDocument.create(
      'file:///example-dynamic.hbs',
      'handlebars',
      1,
      "{{#each items as |item|}}\n  {{> (concat 'x/y/' item)\n    (component 'z')\n  }}\n{{/each}}",
    );
    const diagnostics = validateHandlebarsBalance(document);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('analyzeBlockStructure', () => {
  it('returns no issues for balanced blocks', () => {
    const result = analyzeBlockStructure('{{#if condition}}content{{/if}}');
    expect(result.issues).toHaveLength(0);
    expect(result.openStack).toHaveLength(0);
  });

  it('returns no issues for nested balanced blocks', () => {
    const result = analyzeBlockStructure(
      '{{#if a}}{{#each items}}item{{/each}}{{/if}}',
    );
    expect(result.issues).toHaveLength(0);
    expect(result.openStack).toHaveLength(0);
  });

  it('detects unclosed block', () => {
    const result = analyzeBlockStructure('{{#if condition}}content');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('unclosed-open');
    expect(result.issues[0].token.name).toBe('if');
  });

  it('detects stray closing tag', () => {
    const result = analyzeBlockStructure('content{{/if}}');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('stray-close');
    expect(result.issues[0].token.name).toBe('if');
  });

  it('detects mismatched closing tag', () => {
    const result = analyzeBlockStructure('{{#if condition}}content{{/each}}');
    const mismatch = result.issues.find((i) => i.type === 'mismatch-close');
    expect(mismatch).toBeDefined();
    if (mismatch && mismatch.type === 'mismatch-close') {
      expect(mismatch.expected).toBe('if');
      expect(mismatch.token.name).toBe('each');
    }
  });

  it('detects stray else outside block', () => {
    const result = analyzeBlockStructure('{{else}}');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe('stray-else');
  });

  it('allows else inside a block', () => {
    const result = analyzeBlockStructure(
      '{{#if condition}}yes{{else}}no{{/if}}',
    );
    expect(result.issues).toHaveLength(0);
  });

  it('handles else if inside a block', () => {
    const result = analyzeBlockStructure(
      '{{#if a}}yes{{else if b}}maybe{{else}}no{{/if}}',
    );
    expect(result.issues).toHaveLength(0);
  });

  it('handles multiple unclosed blocks', () => {
    const result = analyzeBlockStructure('{{#if a}}{{#each items}}content');
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.type === 'unclosed-open')).toBe(true);
  });

  it('returns empty for plain text', () => {
    const result = analyzeBlockStructure('Hello world');
    expect(result.issues).toHaveLength(0);
    expect(result.openStack).toHaveLength(0);
  });

  it('returns empty for empty string', () => {
    const result = analyzeBlockStructure('');
    expect(result.issues).toHaveLength(0);
  });

  it('handles tilde whitespace control in blocks', () => {
    const result = analyzeBlockStructure('{{~#if condition~}}content{{~/if~}}');
    expect(result.issues).toHaveLength(0);
  });
});
