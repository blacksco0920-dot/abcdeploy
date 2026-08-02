import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareCommandSets,
  extractBundledCommands,
  extractRegisteredCommands,
  extractSourceCommands,
} from "./lib/desktop-command-surface.mjs";

const fixtures = new URL(
  "./fixtures/desktop-command-surface/",
  import.meta.url,
);

async function fixture(name) {
  return readFile(new URL(name, fixtures), "utf8");
}

test("extractSourceCommands 收集 invoke 的泛型、多行与别名静态命令", async () => {
  const filePath = fileURLToPath(new URL("source-valid.ts", fixtures));
  const result = extractSourceCommands(
    await fixture("source-valid.ts"),
    filePath,
  );

  assert.deepEqual(result.commands, ["alpha", "beta", "gamma"]);
  assert.deepEqual(result.dynamicInvocations, []);
});

test("extractSourceCommands 为动态 invoke 保留文件和起始行号", async () => {
  const filePath = fileURLToPath(new URL("source-dynamic.ts", fixtures));
  const result = extractSourceCommands(
    await fixture("source-dynamic.ts"),
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(
    result.dynamicInvocations.map(({ file, line }) => ({ file, line })),
    [3, 4, 5].map((line) => ({ file: filePath, line })),
  );
});

test("extractRegisteredCommands 提取唯一 generate_handler 中的标识符", async () => {
  const result = extractRegisteredCommands(await fixture("handler-valid.rs"));

  assert.deepEqual(result.commands, ["alpha", "beta", "gamma"]);
});

test("extractRegisteredCommands 拒绝多个可判定 generate_handler", async () => {
  const invalid = await fixture("handler-invalid.rs");

  assert.throws(
    () => extractRegisteredCommands(invalid),
    /只能存在一个可判定的 generate_handler/,
  );
});

test("extractBundledCommands 只保留既注册又作为 AST 字符串字面量出现的命令", async () => {
  const result = extractBundledCommands(await fixture("bundle-valid.js"), [
    "alpha",
    "beta",
    "gamma",
  ]);

  assert.deepEqual(result.commands, ["alpha", "gamma"]);
});

test("compareCommandSets 报告四类去重且排序的命令面差集", () => {
  const result = compareCommandSets({
    sourceCommands: ["alpha", "gamma", "gamma"],
    registeredCommands: ["alpha", "beta", "beta"],
    bundledCommands: ["alpha", "delta"],
  });

  assert.deepEqual(result, {
    missingRegistrations: ["delta", "gamma"],
    registeredOnly: ["beta"],
    bundleOnly: ["delta"],
    sourceNotBundled: ["gamma"],
  });
});
