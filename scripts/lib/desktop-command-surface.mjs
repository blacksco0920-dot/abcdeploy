import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const ts = require("typescript");

const CORE_MODULE = "@tauri-apps/api/core";
const HANDLER_PATTERN = /tauri\s*::\s*generate_handler\s*!\s*\[([^\]]*)\]/g;
const RUST_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function extractSourceCommands(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const invokeBindings = new Set();
  const commands = [];
  const dynamicInvocations = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.moduleSpecifier.text !== CORE_MODULE
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "invoke") {
        invokeBindings.add(element.name.text);
      }
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      invokeBindings.has(node.expression.text)
    ) {
      const command = node.arguments[0];
      if (command && ts.isStringLiteral(command)) {
        commands.push(command.text);
      } else {
        dynamicInvocations.push(sourceLocation(node, sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { commands: sortedUnique(commands), dynamicInvocations };
}

export function extractRegisteredCommands(sourceText) {
  const uncommented = sourceText.replace(/\/\/.*$/gm, "");
  const matches = [...uncommented.matchAll(HANDLER_PATTERN)];

  if (matches.length !== 1) {
    throw new Error("只能存在一个可判定的 generate_handler");
  }

  const commands = matches[0][1]
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean);

  if (!commands.every((command) => RUST_IDENTIFIER.test(command))) {
    throw new Error("generate_handler 只能包含 Rust 标识符");
  }

  return { commands: sortedUnique(commands) };
}

export function extractBundledCommands(sourceText, registeredCommands) {
  const sourceFile = ts.createSourceFile(
    "bundle.js",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const registered = new Set(registeredCommands);
  const commands = [];

  function visit(node) {
    if (ts.isStringLiteral(node) && registered.has(node.text)) {
      commands.push(node.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { commands: sortedUnique(commands) };
}

export function compareCommandSets({
  sourceCommands,
  registeredCommands,
  bundledCommands,
}) {
  const source = new Set(sourceCommands);
  const registered = new Set(registeredCommands);
  const bundled = new Set(bundledCommands);
  const sourceOrBundled = new Set([...source, ...bundled]);

  return {
    missingRegistrations: difference(sourceOrBundled, registered),
    registeredOnly: difference(registered, sourceOrBundled),
    bundleOnly: difference(bundled, source),
    sourceNotBundled: difference(source, bundled),
  };
}

function difference(left, right) {
  return sortedUnique([...left].filter((value) => !right.has(value)));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sourceLocation(node, sourceFile) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1 };
}
