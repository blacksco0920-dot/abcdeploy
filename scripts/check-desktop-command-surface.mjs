#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  auditDesktopCommandSurface,
  commandSurfaceFailures,
} from "./lib/desktop-command-surface.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

try {
  const options = parseArguments(process.argv.slice(2));
  const result = await auditDesktopCommandSurface({ root, mode: options.mode });
  const failures = commandSurfaceFailures(result);

  process.stdout.write(
    options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatResult(result, failures),
  );
  if (failures.length > 0) {
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

function formatResult(result, failures) {
  const lines = [
    "桌面命令面审计",
    `mode=${result.mode}`,
    `registered=${result.registeredCommands.length}`,
  ];

  if (result.sourceCommands) {
    lines.push(`source=${result.sourceCommands.length}`);
  }
  if (result.bundledCommands) {
    lines.push(`bundled=${result.bundledCommands.length}`);
  }
  if (result.dynamicInvocations) {
    lines.push(formatList("dynamicInvocations", result.dynamicInvocations));
  }

  for (const [name, commands] of Object.entries(result.differences)) {
    lines.push(formatList(name, commands));
  }
  if (failures.length > 0) {
    lines.push(
      "命令面契约失败：",
      ...failures.map((failure) => `- ${failure}`),
    );
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
