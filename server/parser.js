/**
 * Extracts module references from a single source file.
 *
 * Uses the real TypeScript parser (syntax only, no type-checking) so that
 * imports inside strings, comments or template literals are never mistaken
 * for dependencies, and so that `import type` is distinguishable from a
 * runtime import.
 */
import ts from 'typescript';

export const PARSEABLE_SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export const PARSEABLE_STYLE = /\.(?:less|scss|sass|css)$/;

/**
 * Edge kinds, in order of "strength". When the same file is referenced
 * several times, the strongest kind wins for display purposes.
 *   import    - static `import x from 'y'` / `import 'y'`
 *   reexport  - `export ... from 'y'`
 *   dynamic   - `import('y')` (lazy loaded / code-split)
 *   require   - `require('y')`
 *   url       - `new URL('y', import.meta.url)` (workers, assets)
 *   style     - `@import 'y'` in css/less/scss
 *   type      - type-only reference, erased at compile time
 */
export const EDGE_KINDS = [
  'import',
  'reexport',
  'dynamic',
  'require',
  'url',
  'style',
  'type',
];

function scriptKindFor(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  // Plain .js files in this repo contain JSX.
  return ts.ScriptKind.JSX;
}

function stringArg(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function isImportMetaUrl(node) {
  return (
    node &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'url' &&
    ts.isMetaProperty(node.expression)
  );
}

function importClauseIsTypeOnly(clause) {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  // `import { type A, type B } from 'x'` - every specifier is type-only.
  const named = clause.namedBindings;
  if (
    !clause.name &&
    named &&
    ts.isNamedImports(named) &&
    named.elements.length > 0
  ) {
    return named.elements.every(el => el.isTypeOnly);
  }
  return false;
}

function parseScript(file, text) {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(file),
  );
  const refs = [];
  const add = (spec, kind, node) => {
    if (!spec) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    refs.push({ spec, kind, line: line + 1 });
  };

  const visit = node => {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        add(
          stringArg(node.moduleSpecifier),
          importClauseIsTypeOnly(node.importClause) ? 'type' : 'import',
          node,
        );
        return; // nothing nested that we care about
      case ts.SyntaxKind.ExportDeclaration:
        if (node.moduleSpecifier) {
          add(
            stringArg(node.moduleSpecifier),
            node.isTypeOnly ? 'type' : 'reexport',
            node,
          );
        }
        return;
      case ts.SyntaxKind.ImportEqualsDeclaration:
        if (
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression
        ) {
          add(
            stringArg(node.moduleReference.expression),
            node.isTypeOnly ? 'type' : 'require',
            node,
          );
        }
        break;
      case ts.SyntaxKind.ImportType: // import('x').Foo in a type position
        if (ts.isLiteralTypeNode(node.argument)) {
          add(stringArg(node.argument.literal), 'type', node);
        }
        break;
      case ts.SyntaxKind.CallExpression: {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) {
          add(stringArg(node.arguments[0]), 'dynamic', node);
        } else if (
          ts.isIdentifier(callee) &&
          callee.text === 'require' &&
          node.arguments.length === 1
        ) {
          add(stringArg(node.arguments[0]), 'require', node);
        }
        break;
      }
      case ts.SyntaxKind.NewExpression:
        // new Worker(new URL('./worker.ts', import.meta.url))
        if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'URL' &&
          node.arguments &&
          node.arguments.length === 2 &&
          isImportMetaUrl(node.arguments[1])
        ) {
          add(stringArg(node.arguments[0]), 'url', node);
        }
        break;
      default:
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

const STYLE_IMPORT =
  /@import\s+(?:\([^)]*\)\s*)?(?:url\()?\s*['"]([^'"]+)['"]/g;

function parseStyle(text) {
  const refs = [];
  // Blank out comments (keeping newlines so line numbers stay right).
  // `//` comments only exist in less/scss, and must not eat `url(http://...)`.
  const blank = m => m.replace(/[^\n]/g, ' ');
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:'"(])\/\/[^\n]*/g,
      (m, pre) => pre + blank(m.slice(pre.length)),
    );
  let m;
  while ((m = STYLE_IMPORT.exec(stripped))) {
    const line = stripped.slice(0, m.index).split('\n').length;
    refs.push({ spec: m[1], kind: 'style', line });
  }
  return refs;
}

/** @returns {{spec: string, kind: string, line: number}[]} */
export function extractReferences(file, text) {
  if (PARSEABLE_SCRIPT.test(file)) return parseScript(file, text);
  if (PARSEABLE_STYLE.test(file)) return parseStyle(text);
  return [];
}
