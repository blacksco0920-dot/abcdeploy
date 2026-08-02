import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
    const scope = scopeFor(node, invokeBindings);

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      invokeBindings.has(node.expression.text) &&
      !scope.has(node.expression.text)
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

  function scopeFor(node, invokeBindings) {
    const bindings = new Set();

    for (let parent = node.parent; parent; parent = parent.parent) {
      addScopeBindings(parent, bindings, invokeBindings);
    }

    return bindings;
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

export async function auditDesktopCommandSurface({ root, mode }) {
  if (!new Set(["source", "bundle", "all"]).has(mode)) {
    throw new Error(`未知审计模式: ${mode}`);
  }

  const registeredSource = await readFile(
    join(root, "apps", "desktop", "src-tauri", "src", "lib.rs"),
    "utf8",
  );
  const { commands: registeredCommands } =
    extractRegisteredCommands(registeredSource);
  const sourceFiles = await productionSourceFiles(
    join(root, "apps", "desktop", "src"),
  );
  const sourceCommands = [];
  const dynamicInvocations = [];

  for (const file of sourceFiles) {
    const extracted = extractSourceCommands(await readFile(file, "utf8"), file);
    sourceCommands.push(...extracted.commands);
    dynamicInvocations.push(...extracted.dynamicInvocations);
  }

  const sortedSourceCommands = sortedUnique(sourceCommands);
  let bundledCommands = [];

  if (mode !== "source") {
    const bundleDirectory = join(root, "apps", "desktop", "dist", "assets");
    const entries = await readdir(bundleDirectory, { withFileTypes: true });
    const bundleFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => join(bundleDirectory, entry.name))
      .sort();

    if (bundleFiles.length === 0) {
      throw new Error("生产 bundle 不存在，请先运行桌面 Vite build");
    }

    for (const file of bundleFiles) {
      bundledCommands.push(
        ...extractBundledCommands(
          await readFile(file, "utf8"),
          registeredCommands,
        ).commands,
      );
    }
    bundledCommands = sortedUnique(bundledCommands);
  }

  return {
    registeredCommands,
    sourceCommands: sortedSourceCommands,
    bundledCommands,
    dynamicInvocations,
    differences: compareCommandSets({
      registeredCommands,
      sourceCommands: sortedSourceCommands,
      bundledCommands:
        mode === "source" ? sortedSourceCommands : bundledCommands,
    }),
  };
}

function difference(left, right) {
  return sortedUnique([...left].filter((value) => !right.has(value)));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function productionSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test") {
        files.push(...(await productionSourceFiles(path)));
      }
      continue;
    }
    if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) &&
      entry.name !== "vite-env.d.ts"
    ) {
      files.push(path);
    }
  }

  return files.sort();
}

function addScopeBindings(node, bindings, invokeBindings) {
  if (ts.isSourceFile(node)) {
    collectVarBindings(node, bindings, invokeBindings);
    addLexicalBindings(node.statements, bindings, invokeBindings);
    for (const statement of node.statements) {
      if (ts.isImportDeclaration(statement)) {
        addImportBindings(statement, bindings, invokeBindings);
      }
    }
  } else if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) {
      addBindingName(parameter.name, bindings, invokeBindings);
    }
    if (ts.isFunctionExpression(node) && node.name) {
      addBindingName(node.name, bindings, invokeBindings);
    }
    if (node.body) {
      collectVarBindings(node.body, bindings, invokeBindings);
    }
  } else if (ts.isBlock(node) || ts.isModuleBlock(node)) {
    addLexicalBindings(node.statements, bindings, invokeBindings);
  } else if (ts.isCatchClause(node) && node.variableDeclaration) {
    addBindingName(node.variableDeclaration.name, bindings, invokeBindings);
  } else if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      addVariableBindings(node.initializer, bindings, invokeBindings);
    }
  } else if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) {
      addLexicalBindings(clause.statements, bindings, invokeBindings);
    }
  }
}

function addLexicalBindings(statements, bindings, invokeBindings) {
  for (const statement of statements) {
    if (
      ts.isVariableStatement(statement) &&
      isBlockScopedVariableDeclarationList(statement.declarationList)
    ) {
      addVariableBindings(statement.declarationList, bindings, invokeBindings);
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      addBindingName(statement.name, bindings, invokeBindings);
    }
  }
}

function addImportBindings(statement, bindings, invokeBindings) {
  const clause = statement.importClause;
  if (!clause) {
    return;
  }

  if (clause.name) {
    addBindingName(clause.name, bindings, invokeBindings);
  }
  if (!clause.namedBindings) {
    return;
  }
  if (ts.isNamespaceImport(clause.namedBindings)) {
    addBindingName(clause.namedBindings.name, bindings, invokeBindings);
    return;
  }

  for (const element of clause.namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (
      statement.moduleSpecifier.text === CORE_MODULE &&
      importedName === "invoke"
    ) {
      continue;
    }
    addBindingName(element.name, bindings, invokeBindings);
  }
}

function collectVarBindings(node, bindings, invokeBindings) {
  function visit(child) {
    if (
      child !== node &&
      (ts.isFunctionLike(child) ||
        ts.isClassDeclaration(child) ||
        ts.isClassExpression(child))
    ) {
      return;
    }
    if (
      ts.isVariableDeclaration(child) &&
      !isBlockScopedVariableDeclarationList(child.parent)
    ) {
      addBindingName(child.name, bindings, invokeBindings);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
}

function isBlockScopedVariableDeclarationList(declarationList) {
  return Boolean(
    ts.getCombinedNodeFlags(declarationList) & ts.NodeFlags.BlockScoped,
  );
}

function addVariableBindings(declarationList, bindings, invokeBindings) {
  for (const declaration of declarationList.declarations) {
    addBindingName(declaration.name, bindings, invokeBindings);
  }
}

function addBindingName(name, bindings, invokeBindings) {
  if (ts.isIdentifier(name)) {
    if (invokeBindings.has(name.text)) {
      bindings.add(name.text);
    }
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      addBindingName(element.name, bindings, invokeBindings);
    }
  }
}

function sourceLocation(node, sourceFile) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1 };
}
