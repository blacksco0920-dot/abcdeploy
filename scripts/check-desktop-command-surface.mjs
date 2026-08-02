#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { auditDesktopCommandSurface } from "./lib/desktop-command-surface.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await auditDesktopCommandSurface({ root, mode: options.mode });

  process.stdout.write(
    options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatResult(result),
  );
  if (hasFailures(result)) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `桌面命令面审计失败: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(args) {
  let mode;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mode") {
      mode = args[index + 1];
      index += 1;
    } else if (argument === "--json") {
      json = true;
    } else {
      throw new Error(`未知参数: ${argument}`);
    }
  }

  if (!mode) {
    throw new Error("必须指定 --mode source|bundle|all");
  }

  return { mode, json };
}

function hasFailures(result) {
  return (
    result.dynamicInvocations.length > 0 ||
    Object.values(result.differences).some((commands) => commands.length > 0)
  );
}

function formatResult(result) {
  const lines = [
    "桌面命令面审计",
    `registered=${result.registeredCommands.length}`,
    `source=${result.sourceCommands.length}`,
    `bundled=${result.bundledCommands.length}`,
    formatList("dynamicInvocations", result.dynamicInvocations),
  ];

  for (const [name, commands] of Object.entries(result.differences)) {
    lines.push(formatList(name, commands));
  }

  return `${lines.join("\n")}\n`;
}

function formatList(name, values) {
  return `${name}(${values.length})=${
    values.length === 0 ? "[]" : values.map(formatValue).join(",")
  }`;
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return `${value.file}:${value.line}`;
}
