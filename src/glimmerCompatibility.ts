import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { DocumentAnalysis, ParseErrorInfo } from './types.js';

const GLIMMER_UNSUPPORTED_PARSE_MESSAGES = [
  'A block may only be used inside an HTML element or another block',
  'Handlebars partials are not supported',
  'Handlebars partial blocks are not supported',
  'Handlebars decorator blocks are not supported',
  'Cannot use mustaches in an elements tagname',
  'Changing context using "../" is not supported in Glimmer',
  "'.' is not a supported path in Glimmer; check for a path with a trailing '.'",
  'Using a Handlebars comment when in the `attributeValueDoubleQuoted` state is not supported',
] as const;

const OPTIONAL_HTML_END_TAGS = new Set([
  'li',
  'p',
  'dt',
  'dd',
  'option',
  'optgroup',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'colgroup',
  'rb',
  'rp',
  'rt',
  'rtc',
]);

export function isKnownGlimmerCompatibilityFalsePositive(
  document: TextDocument,
  analysis: DocumentAnalysis,
  error: ParseErrorInfo,
): boolean {
  if (
    GLIMMER_UNSUPPORTED_PARSE_MESSAGES.some((message) =>
      error.message.includes(message),
    )
  ) {
    return true;
  }

  if (
    analysis.usedSanitization &&
    (error.message.includes('Unclosed element') ||
      error.message.includes('Closing tag') ||
      error.message.includes('End tag') ||
      error.message.includes('not a valid character within attribute names') ||
      error.message.includes("Expecting 'EOF', got 'OPEN_ENDBLOCK'") ||
      error.message.includes("Expecting 'EOF', got 'OPEN_BLOCK'") ||
      error.message.includes(
        "Expecting 'OPEN_INVERSE_CHAIN', 'INVERSE', 'OPEN_ENDBLOCK', got 'EOF'",
      ))
  ) {
    return true;
  }

  if (isLikelyConditionalHtmlStructureFalsePositive(document, error)) {
    return true;
  }

  if (isLikelyOptionalEndTagFalsePositive(error)) {
    return true;
  }

  if (isLikelyRawScriptStyleFalsePositive(document, analysis, error)) {
    return true;
  }

  if (isLikelyXmlDeclarationFalsePositive(document, error)) {
    return true;
  }

  return isLikelyBracketPathFalsePositive(document, error);
}

function isLikelyConditionalHtmlStructureFalsePositive(
  document: TextDocument,
  error: ParseErrorInfo,
): boolean {
  if (
    !error.message.includes('Unclosed element') &&
    !error.message.includes('Closing tag') &&
    !error.message.includes('End tag')
  ) {
    return false;
  }

  const text = document.getText();
  const hasInlineMixedTagAndHandlebars = text
    .split(/\r?\n/)
    .some(
      (line) =>
        /{{[^}]*}}.*<\/?[A-Za-z][^>]*>/.test(line) ||
        /<\/?[A-Za-z][^>]*>.*{{[^}]*}}/.test(line),
    );

  if (hasInlineMixedTagAndHandlebars) {
    return true;
  }

  const conditionalOpenTagMatch = error.message.match(/Unclosed element `([^`]+)`/);
  if (!conditionalOpenTagMatch) {
    return false;
  }

  const tagName = conditionalOpenTagMatch[1];
  const conditionalOpen = new RegExp(
    String.raw`{{[^}]*#(?:if|unless)\b[^}]*}}[\s\S]*?<${tagName}\b`,
    'i',
  );
  const conditionalClose = new RegExp(
    String.raw`{{[^}]*#(?:if|unless)\b[^}]*}}[\s\S]*?</${tagName}>`,
    'i',
  );
  return conditionalOpen.test(text) && conditionalClose.test(text);
}

function isLikelyOptionalEndTagFalsePositive(error: ParseErrorInfo): boolean {
  const match = error.message.match(
    /Closing tag <\/([^>]+)> did not match last open tag <([^>]+)>/,
  );
  if (!match) {
    return false;
  }

  const [, closingTag, openTag] = match;
  return closingTag !== openTag && OPTIONAL_HTML_END_TAGS.has(openTag);
}

function isLikelyRawScriptStyleFalsePositive(
  document: TextDocument,
  analysis: DocumentAnalysis,
  error: ParseErrorInfo,
): boolean {
  if (
    !document.getText().match(/<(script|style)\b/i) ||
    analysis.blockAnalysis.issues.length > 0
  ) {
    return false;
  }

  return /doesn't match/.test(error.message);
}

function isLikelyXmlDeclarationFalsePositive(
  document: TextDocument,
  error: ParseErrorInfo,
): boolean {
  return (
    error.message.includes('Unclosed element `xml`') &&
    document.getText().startsWith('<?xml ')
  );
}

function isLikelyBracketPathFalsePositive(
  document: TextDocument,
  error: ParseErrorInfo,
): boolean {
  if (!error.message.includes("Expecting 'ID', got 'INVALID'")) {
    return false;
  }

  const startLine = error.location?.startLine;
  if (!startLine) {
    return false;
  }

  const lines = document.getText().split(/\r?\n/);
  const line = lines[startLine - 1] ?? '';
  const startColumn = error.location?.startColumn ?? 0;
  const bracketOpenBefore = line.lastIndexOf('[', startColumn);
  const bracketOpenAfter = line.indexOf('[', startColumn);
  const bracketOpen =
    bracketOpenBefore !== -1 ? bracketOpenBefore : bracketOpenAfter;
  const bracketClose = bracketOpen === -1 ? -1 : line.indexOf(']', bracketOpen);
  return bracketOpen !== -1 && bracketClose !== -1 && bracketOpen < bracketClose;
}
