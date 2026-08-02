import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createTypeScriptBindingContext,
  directCallForIdentifier,
  valueSymbolForIdentifier,
} from "./typescript-invoke-bindings.mjs";

const require = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const ts = require("typescript");

const CORE_MODULE = "@tauri-apps/api/core";
const MISSING_BUNDLE_MESSAGE = "生产 bundle 构建产物缺失，请先运行 Vite build";
const HANDLER_PATTERN = /tauri\s*::\s*generate_handler\s*!\s*\[([^\]]*)\]/g;
const RUST_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAMESPACE_IMPORT_REASON =
  "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke";
const OPTIONAL_CALL_REASON = "导入的 invoke 绑定不支持可选调用";
const UNSUPPORTED_VALUE_USE_REASON =
  "导入的 invoke 绑定只能作为非可选直接调用的被调用方";

export function extractSourceCommands(sourceText, filePath) {
  const { checker, sourceFile } = createTypeScriptBindingContext(
    sourceText,
    filePath,
  );
  const importedInvokeSymbols = new Set();
  const commands = [];
  const dynamicInvocations = [];
  const unsupportedInvocations = new Map();

  function reportUnsupported(node, reason) {
    const position = node.getStart(sourceFile);
    unsupportedInvocations.set(`${position}:${reason}`, {
      ...sourceLocation(node, sourceFile),
      position,
      reason,
    });
  }

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.moduleSpecifier.text !== CORE_MODULE
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;
    if (!bindings) {
      continue;
    }

    if (ts.isNamespaceImport(bindings)) {
      reportUnsupported(bindings.name, NAMESPACE_IMPORT_REASON);
      continue;
    }

    if (statement.importClause?.isTypeOnly) {
      continue;
    }
    for (const element of bindings.elements) {
      if (
        !element.isTypeOnly &&
        (element.propertyName?.text ?? element.name.text) === "invoke"
      ) {
        const symbol = checker.getSymbolAtLocation(element.name);
        if (symbol) {
          importedInvokeSymbols.add(symbol);
        }
      }
    }
  }

  function visit(node) {
    if (ts.isTypeNode(node)) {
      return;
    }
    if (
      (ts.isExportDeclaration(node) || ts.isExportSpecifier(node)) &&
      node.isTypeOnly
    ) {
      return;
    }
    if (ts.isImportDeclaration(node)) {
      return;
    }

    if (
      ts.isIdentifier(node) &&
      importedInvokeSymbols.has(valueSymbolForIdentifier(checker, node))
    ) {
      const call = directCallForIdentifier(node);
      if (!call) {
        reportUnsupported(node, UNSUPPORTED_VALUE_USE_REASON);
        return;
      }
      if (call.questionDotToken) {
        reportUnsupported(node, OPTIONAL_CALL_REASON);
        return;
      }
      const command = call.arguments[0];
      if (command && ts.isStringLiteral(command)) {
        commands.push(command.text);
      } else {
        dynamicInvocations.push(sourceLocation(call, sourceFile));
      }
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    commands: sortedUnique(commands),
    dynamicInvocations,
    unsupportedInvocations: [...unsupportedInvocations.values()]
      .sort((left, right) => left.position - right.position)
      .map(({ file, line, reason }) => ({ file, line, reason })),
  };
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

export function commandSurfaceFailures(result) {
  const failures = (result.dynamicInvocations ?? []).map(
    ({ file, line }) => `桌面命令调用必须使用字符串字面量：${file}:${line}`,
  );
  failures.push(
    ...(result.unsupportedInvocations ?? []).map(
      ({ file, line, reason }) =>
        `桌面命令 invoke 用法无法静态证明（${reason}）：${file}:${line}`,
    ),
  );
  const differenceMessages = [
    ["missingRegistrations", "桌面命令未注册"],
    ["registeredOnly", "Tauri 注册命令没有当前消费者"],
    ["bundleOnly", "桌面命令只存在于生产 bundle"],
    ["sourceNotBundled", "桌面源码命令未进入生产 bundle"],
  ];

  for (const [name, message] of differenceMessages) {
    for (const command of result.differences[name] ?? []) {
      failures.push(`${message}：${command}`);
    }
  }

  return failures;
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
  let sourceCommands;
  let dynamicInvocations;
  let unsupportedInvocations;
  let bundledCommands;

  const sourceFiles = await productionSourceFiles(
    join(root, "apps", "desktop", "src"),
  );
  const extractedSourceCommands = [];
  dynamicInvocations = [];
  unsupportedInvocations = [];

  for (const file of sourceFiles) {
    const extracted = extractSourceCommands(await readFile(file, "utf8"), file);
    extractedSourceCommands.push(...extracted.commands);
    dynamicInvocations.push(...extracted.dynamicInvocations);
    unsupportedInvocations.push(...extracted.unsupportedInvocations);
  }
  sourceCommands = sortedUnique(extractedSourceCommands);

  if (mode !== "source") {
    const bundleDirectory = join(root, "apps", "desktop", "dist", "assets");
    let entries;
    try {
      entries = await readdir(bundleDirectory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        throw new Error(MISSING_BUNDLE_MESSAGE);
      }
      throw error;
    }
    const bundleFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => join(bundleDirectory, entry.name))
      .sort();

    if (bundleFiles.length === 0) {
      throw new Error(MISSING_BUNDLE_MESSAGE);
    }

    const extractedCommands = [];
    for (const file of bundleFiles) {
      extractedCommands.push(
        ...extractBundledCommands(
          await readFile(file, "utf8"),
          registeredCommands,
        ).commands,
      );
    }
    bundledCommands = sortedUnique(extractedCommands);
  }

  if (mode === "source") {
    return {
      mode,
      registeredCommands,
      sourceCommands,
      dynamicInvocations,
      ...(unsupportedInvocations.length > 0 ? { unsupportedInvocations } : {}),
      differences: compareRegistrationSet(sourceCommands, registeredCommands),
    };
  }

  if (mode === "bundle") {
    return {
      mode,
      registeredCommands,
      sourceCommands,
      bundledCommands,
      dynamicInvocations,
      ...(unsupportedInvocations.length > 0 ? { unsupportedInvocations } : {}),
      differences: compareCommandSets({
        registeredCommands,
        sourceCommands,
        bundledCommands,
      }),
    };
  }

  return {
    mode,
    registeredCommands,
    sourceCommands,
    bundledCommands,
    dynamicInvocations,
    ...(unsupportedInvocations.length > 0 ? { unsupportedInvocations } : {}),
    differences: compareCommandSets({
      registeredCommands,
      sourceCommands,
      bundledCommands,
    }),
  };
}

function compareRegistrationSet(commands, registeredCommands) {
  const checked = new Set(commands);
  const registered = new Set(registeredCommands);

  return {
    missingRegistrations: difference(checked, registered),
    registeredOnly: difference(registered, checked),
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

function sourceLocation(node, sourceFile) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1 };
}
