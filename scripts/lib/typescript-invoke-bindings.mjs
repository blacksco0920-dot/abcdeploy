import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const ts = require("typescript");

export function createTypeScriptBindingContext(sourceText, filePath) {
  const options = {
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    options.target,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const originalHost = ts.createCompilerHost(options, true);
  const matchesRoot = (candidate) =>
    ts.sys.resolvePath(candidate) === ts.sys.resolvePath(filePath);
  const host = {
    ...originalHost,
    fileExists(candidate) {
      return matchesRoot(candidate) || originalHost.fileExists(candidate);
    },
    getSourceFile(candidate, ...args) {
      return matchesRoot(candidate)
        ? sourceFile
        : originalHost.getSourceFile(candidate, ...args);
    },
    readFile(candidate) {
      return matchesRoot(candidate)
        ? sourceText
        : originalHost.readFile(candidate);
    },
  };
  const program = ts.createProgram({
    host,
    options,
    rootNames: [filePath],
  });

  return {
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(filePath) ?? sourceFile,
  };
}

export function directCallForIdentifier(identifier) {
  let expression = identifier;
  while (
    expression.parent &&
    isTransparentExpression(expression.parent) &&
    expression.parent.expression === expression
  ) {
    expression = expression.parent;
  }

  const call = expression.parent;
  return ts.isCallExpression(call) && call.expression === expression
    ? call
    : undefined;
}

export function valueSymbolForIdentifier(checker, identifier) {
  if (
    ts.isExportSpecifier(identifier.parent) &&
    (identifier.parent.propertyName ?? identifier.parent.name) === identifier
  ) {
    return (
      checker.getExportSpecifierLocalTargetSymbol(identifier.parent) ??
      checker.getSymbolAtLocation(identifier)
    );
  }
  if (
    ts.isShorthandPropertyAssignment(identifier.parent) &&
    identifier.parent.name === identifier
  ) {
    return (
      checker.getShorthandAssignmentValueSymbol(identifier.parent) ??
      checker.getSymbolAtLocation(identifier)
    );
  }
  return checker.getSymbolAtLocation(identifier);
}

function isTransparentExpression(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}
