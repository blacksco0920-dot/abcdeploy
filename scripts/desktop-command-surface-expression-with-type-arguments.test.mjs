import assert from "node:assert/strict";
import test from "node:test";

import { extractSourceCommands } from "./lib/desktop-command-surface.mjs";

const unsupportedValueUseReason =
  "导入的 invoke 绑定只能作为非可选直接调用的被调用方";

test("extractSourceCommands 忽略 interface extends 中的纯类型 invoke 引用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
interface Contract extends invoke<string> {}`,
    "/virtual/interface-extends.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 忽略 class implements 中的纯类型 invoke 引用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
class Implementation implements invoke<string> {}`,
    "/virtual/class-implements.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 收集括号包裹的泛型 invoke 直接调用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
(invoke<string>)("generic_command");`,
    "/virtual/parenthesized-instantiation.ts",
  );

  assert.deepEqual(result.commands, ["generic_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 仍检查 class extends 中的运行时 invoke 引用", () => {
  const file = "/virtual/class-extends.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
class RuntimeSubclass extends invoke<string> {}`,
    file,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    { file, line: 2, reason: unsupportedValueUseReason },
  ]);
});
