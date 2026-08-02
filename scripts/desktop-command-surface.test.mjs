import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditDesktopCommandSurface,
  commandSurfaceFailures,
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

async function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function createAuditFixture({ source = true, bundle = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "desktop-command-surface-"));

  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await mkdir(join(root, "apps", "desktop", "src-tauri", "src"), {
    recursive: true,
  });
  if (source) {
    await mkdir(join(root, "apps", "desktop", "src"), { recursive: true });
  }
  if (bundle) {
    await mkdir(join(root, "apps", "desktop", "dist", "assets"), {
      recursive: true,
    });
  }
  const cliSource = await readFile(
    new URL("./check-desktop-command-surface.mjs", import.meta.url),
    "utf8",
  ).catch(() => assert.fail("CLI 尚不存在"));
  await writeFile(
    join(root, "scripts", "check-desktop-command-surface.mjs"),
    cliSource,
  );
  await copyFile(
    new URL("./lib/desktop-command-surface.mjs", import.meta.url),
    join(root, "scripts", "lib", "desktop-command-surface.mjs"),
  );
  await copyFile(
    new URL("./lib/typescript-invoke-bindings.mjs", import.meta.url),
    join(root, "scripts", "lib", "typescript-invoke-bindings.mjs"),
  );
  await symlink(
    fileURLToPath(new URL("../apps/desktop/node_modules", import.meta.url)),
    join(root, "apps", "desktop", "node_modules"),
    "dir",
  );
  await writeFile(
    join(root, "apps", "desktop", "src-tauri", "src", "lib.rs"),
    "tauri::generate_handler![beta, alpha, beta]",
  );
  if (source) {
    await writeFile(
      join(root, "apps", "desktop", "src", "commands.ts"),
      `import { invoke } from "@tauri-apps/api/core";
invoke("gamma");
invoke("alpha");
invoke("gamma");
`,
    );
  }
  if (bundle) {
    await writeFile(
      join(root, "apps", "desktop", "dist", "assets", "index.js"),
      'const command = "alpha";',
    );
  }

  return realpath(root);
}

async function runAudit(root, mode) {
  return runAuditWithOptions(root, mode, { json: true });
}

async function runAuditWithOptions(root, mode, { json }) {
  const args = [
    join(root, "scripts", "check-desktop-command-surface.mjs"),
    "--mode",
    mode,
  ];
  if (json) args.push("--json");

  return run(process.execPath, args, {
    cwd: tmpdir(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function createDesktopBuildFixture() {
  const root = await mkdtemp(join(tmpdir(), "desktop-build-contract-"));
  const desktopDirectory = join(root, "apps", "desktop");
  const binaryDirectory = join(desktopDirectory, "node_modules", ".bin");
  const orderFile = join(root, "build-order.txt");
  const desktopPackage = JSON.parse(
    await readFile(
      new URL("../apps/desktop/package.json", import.meta.url),
      "utf8",
    ),
  );

  await mkdir(binaryDirectory, { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(
    join(desktopDirectory, "package.json"),
    `${JSON.stringify({
      name: "desktop-build-contract-fixture",
      private: true,
      scripts: { build: desktopPackage.scripts.build },
    })}\n`,
  );

  for (const name of ["tsc", "vite"]) {
    const executable = join(binaryDirectory, name);
    await writeFile(
      executable,
      `#!/usr/bin/env node
import("node:fs").then(({ appendFileSync }) => {
  appendFileSync(process.env.BUILD_ORDER, ${JSON.stringify(`${name}\n`)});
});
`,
    );
    await chmod(executable, 0o755);
  }

  await writeFile(
    join(root, "scripts", "check-desktop-command-surface.mjs"),
    `import { appendFileSync } from "node:fs";
appendFileSync(
  process.env.BUILD_ORDER,
  \`gate:\${process.argv.slice(2).join(" ")}\\n\`,
);
process.exit(23);
`,
  );

  return { desktopDirectory, orderFile, root };
}

async function createProjectGateFixture() {
  const root = await createAuditFixture({ bundle: false });
  const requiredDocuments = [
    "ARCHITECTURE.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "SECURITY.md",
    "docs/architecture.md",
    "docs/engineering-quality.md",
    "docs/frontend-design-guidelines.md",
    "docs/implementation-acceptance.md",
    "docs/product-contract.md",
    "docs/internal/README.md",
    "docs/internal/codegraph.md",
    "docs/internal/implementation-inventory.md",
  ];

  await rm(join(root, "apps", "desktop", "src", "commands.ts"));
  await mkdir(join(root, "apps", "desktop", "src", "api"), {
    recursive: true,
  });
  await mkdir(join(root, "docs", "internal"), { recursive: true });
  await copyFile(
    new URL("./check-project-quality.mjs", import.meta.url),
    join(root, "scripts", "check-project-quality.mjs"),
  );
  await writeFile(
    join(root, "apps", "desktop", "src-tauri", "src", "lib.rs"),
    "tauri::generate_handler![]",
  );
  await writeFile(
    join(root, "apps", "desktop", "src", "api", "commands.ts"),
    `import { invoke } from "@tauri-apps/api/core";
export const command = "dynamic_command";
invoke(command);
`,
  );
  await writeFile(
    join(root, "apps", "desktop", "src", "main.tsx"),
    'import { command } from "./api/commands";\nvoid command;\n',
  );
  await writeFile(
    join(root, "apps", "desktop", "package.json"),
    '{"dependencies":{},"devDependencies":{}}\n',
  );
  await writeFile(
    join(root, "AGENTS.md"),
    `## 一分钟冷启动
1. 先读 docs/README.md
2. 再读 docs/current-state.md
OpenSpec Comet CodeGraph
.comet/current-change.json docs/comet/changes/ openspec/changes/
`,
  );
  await writeFile(
    join(root, "README.md"),
    "[当前状态](docs/current-state.md)\n",
  );
  await writeFile(
    join(root, "docs", "README.md"),
    `[当前状态](current-state.md)
[产品合同](product-contract.md)
[架构](architecture.md)
[工程质量](engineering-quality.md)
[前端规范](frontend-design-guidelines.md)
[实施验收](implementation-acceptance.md)
.comet/current-change.json docs/comet/changes/ openspec/changes/
`,
  );
  await writeFile(
    join(root, "docs", "current-state.md"),
    "VERIFIED IMPLEMENTED_UNVERIFIED NEXT TARGET OUT_OF_SCOPE\n",
  );
  await writeFile(join(root, ".editorconfig"), "root = true\n");
  await Promise.all(
    requiredDocuments.map((file) => writeFile(join(root, file), "\n")),
  );

  return root;
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

test("extractSourceCommands 可解析包含普通 const 声明的源码", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const local = 1;
invoke("alpha");`,
    "/virtual/ordinary-const.ts",
  );

  assert.deepEqual(result.commands, ["alpha"]);
  assert.deepEqual(result.dynamicInvocations, []);
});

test("extractSourceCommands 忽略遮蔽导入绑定的函数参数调用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
invoke("alpha");
function invokeLocally(invoke) {
  invoke("not-tauri");
}`,
    "/virtual/shadowed-invoke.ts",
  );

  assert.deepEqual(result.commands, ["alpha"]);
  assert.deepEqual(result.dynamicInvocations, []);
});

test("extractSourceCommands 只在 catch 词法范围内遮蔽导入绑定", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
invoke("before_catch");
try {
  throw new Error("fixture");
} catch (invoke) {
  invoke("ordinary_catch_callback");
}
invoke("after_catch");`,
    "/virtual/catch-shadow.ts",
  );

  assert.deepEqual(result.commands, ["after_catch", "before_catch"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 不把普通对象、绑定和 JSX 的 invoke 属性名当成导入引用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const options = { invoke: ordinaryInvoke };
const { invoke: localInvoke } = options;
const view = <Widget invoke={localInvoke} />;
void view;
invoke("real_command");`,
    "/virtual/ordinary-invoke-properties.tsx",
  );

  assert.deepEqual(result.commands, ["real_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 拒绝导入 invoke 的可选直接调用", () => {
  const filePath = "/virtual/optional-invoke.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
invoke?.("optional_command");
invoke("direct_command");`,
    filePath,
  );

  assert.deepEqual(result.commands, ["direct_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定不支持可选调用",
    },
  ]);
});

test("extractSourceCommands 在计算属性的命名空间 invoke 访问前就拒绝命名空间导入", () => {
  const filePath = "/virtual/namespace-element-access.ts";
  const result = extractSourceCommands(
    `import * as desktopCore from "@tauri-apps/api/core";
const member = "invoke";
desktopCore[member]("element_access");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 1,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
  ]);
});

test("extractSourceCommands 以命名空间导入诊断覆盖别名、回调和重赋值", () => {
  const filePath = "/virtual/namespace-value-flows.ts";
  const result = extractSourceCommands(
    `import * as desktopCore from "@tauri-apps/api/core";
const desktopAlias = desktopCore;
registerCallback(desktopCore);
desktopCore = ordinaryCore;
desktopAlias.invoke("not_proven");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 1,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
  ]);
});

test("extractSourceCommands 拒绝命名空间导入而不猜测其静态或动态调用", () => {
  const filePath = "/virtual/namespace-invoke.ts";
  const result = extractSourceCommands(
    `import * as desktopCore from "@tauri-apps/api/core";
desktopCore.invoke("namespace_static");
desktopCore.invoke(namespaceCommand);`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 1,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
  ]);
});

test("extractSourceCommands 拒绝把具名导入的 invoke 保存为本地别名", () => {
  const filePath = "/virtual/local-invoke-alias.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const callDesktop = invoke;
callDesktop("alias_static");
callDesktop(aliasCommand);`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 只解开具名导入直接调用的 TypeScript 透明表达式", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
(invoke)("parenthesized");
(invoke as typeof invoke)("as_expression");
(<typeof invoke>invoke)("type_assertion");
invoke!("non_null");
(invoke satisfies typeof invoke)("satisfies_expression");
const callDesktop = (invoke as typeof invoke)!;
callDesktop("wrapped_alias");`,
    "/virtual/transparent-invoke.ts",
  );

  assert.deepEqual(result.commands, [
    "as_expression",
    "non_null",
    "parenthesized",
    "satisfies_expression",
    "type_assertion",
  ]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: "/virtual/transparent-invoke.ts",
      line: 7,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 检查带类型参数节点的运行时表达式并跳过纯类型引用", () => {
  const file = "/virtual/expression-with-type-arguments.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
type InvokeType = typeof invoke;
const forwarded = invoke<string>;
class Derived extends invoke("base_command") {}
invoke("direct_command");`, file);

  assert.deepEqual(result.commands, ["base_command", "direct_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [{ file, line: 3,
    reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方" }]);
});

test("extractSourceCommands 拒绝 core 的具名、星号和命名空间值再导出", () => {
  const file = "/virtual/core-value-reexports.ts";
  const result = extractSourceCommands(
    `export { invoke } from "@tauri-apps/api/core";
export * from "@tauri-apps/api/core";
export * as desktopCore from "@tauri-apps/api/core";
export type { invoke as InvokeType } from "@tauri-apps/api/core";
export { type invoke as InlineInvokeType } from "@tauri-apps/api/core";
export type * from "@tauri-apps/api/core";
export type * as DesktopCore from "@tauri-apps/api/core";`, file);

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [1, 2, 3].map((line) => ({ file, line,
    reason: "不支持从 @tauri-apps/api/core 直接值再导出；请具名导入 invoke 并直接调用" })));
});

test("extractSourceCommands 忽略 type-only 命名空间导入", () => {
  const result = extractSourceCommands(
    `import type * as desktopCore from "@tauri-apps/api/core";
import type { invoke as InvokeType } from "@tauri-apps/api/core";`,
    "/virtual/type-only-core-imports.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 忽略 type-only export 中的导入 invoke 引用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
type InvokeType = typeof invoke;
export type { invoke };
export { type invoke as ExportedInvoke };
invoke("real_command");`,
    "/virtual/type-only-invoke-exports.ts",
  );

  assert.deepEqual(result.commands, ["real_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
});

test("extractSourceCommands 拒绝通过 value export 转发导入的 invoke 绑定", () => {
  const filePath = "/virtual/exported-invoke-value.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
export { invoke };
invoke("real_command");`,
    filePath,
  );

  assert.deepEqual(result.commands, ["real_command"]);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 在嵌套块和函数中拒绝保存导入 invoke 的本地别名", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
{
  const callInBlock = invoke;
  callInBlock("nested_block");
}
function runNested() {
  const callInFunction = invoke;
  callInFunction("nested_function");
  {
    const callInFunction = ordinaryCall;
    callInFunction("shadowed_nested_alias");
  }
}
runNested();`,
    "/virtual/nested-const-alias.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: "/virtual/nested-const-alias.ts",
      line: 3,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
    {
      file: "/virtual/nested-const-alias.ts",
      line: 7,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝命名空间和本地别名但仍忽略遮蔽的非 Tauri 调用", () => {
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
import * as desktopCore from "@tauri-apps/api/core";
const callDesktop = invoke;
callDesktop("real_alias");
desktopCore.invoke("real_namespace");
function runWithLocalBindings(callDesktop, desktopCore) {
  callDesktop("shadowed_alias");
  desktopCore.invoke("shadowed_namespace");
}`,
    "/virtual/shadowed-invoke-forms.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: "/virtual/shadowed-invoke-forms.ts",
      line: 2,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
    {
      file: "/virtual/shadowed-invoke-forms.ts",
      line: 3,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 对可变和重赋值别名给出精确拒绝位置", () => {
  const filePath = "/virtual/reassigned-invoke-alias.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
let callDesktop = invoke;
callDesktop("before_reassignment");
callDesktop = localInvoke;
callDesktop("after_reassignment");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝条件分支中的可变别名而不猜测控制流", () => {
  const filePath = "/virtual/conditional-alias-write.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
let callDesktop = invoke;
if (useFallback) {
  callDesktop = localInvoke;
}
callDesktop("not_proven");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝闭包中的别名写入而不采用文本顺序", () => {
  const filePath = "/virtual/closure-alias-write.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const callDesktop = invoke;
function replaceAlias() {
  callDesktop = localInvoke;
}
callDesktop("not_proven_anywhere");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝解构写入并移除原别名的静态假阳性", () => {
  const filePath = "/virtual/destructured-alias-write.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const callDesktop = invoke;
({ value: callDesktop } = ordinaryHelpers);
callDesktop("must_not_be_counted");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝解构和延迟赋值的一跳别名", () => {
  const filePath = "/virtual/unsupported-one-hop-aliases.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
import * as desktopCore from "@tauri-apps/api/core";
const [arrayAlias] = [invoke];
const { invoke: objectAlias } = desktopCore;
let deferredAlias;
deferredAlias = invoke;
arrayAlias("array_command");
objectAlias("object_command");
deferredAlias("deferred_command");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
    {
      file: filePath,
      line: 3,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
    {
      file: filePath,
      line: 6,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝条件和二跳 const 来源", () => {
  const filePath = "/virtual/unsupported-const-provenance.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
const conditionalAlias = useTauri ? invoke : ordinaryCall;
const directAlias = invoke;
const secondHopAlias = directAlias;
conditionalAlias("conditional_command");
secondHopAlias("second_hop_command");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
    {
      file: filePath,
      line: 3,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 拒绝转发、条件调用和命名空间元素访问", () => {
  const filePath = "/virtual/unsupported-invoke-references.ts";
  const result = extractSourceCommands(
    `import { invoke } from "@tauri-apps/api/core";
import * as desktopCore from "@tauri-apps/api/core";
registerCallback(invoke);
(useTauri ? invoke : ordinaryCall)("conditional_call");
desktopCore["invoke"]("element_access");`,
    filePath,
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, [
    {
      file: filePath,
      line: 2,
      reason: "不支持 @tauri-apps/api/core 的命名空间导入；请具名导入 invoke",
    },
    {
      file: filePath,
      line: 3,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
    {
      file: filePath,
      line: 4,
      reason: "导入的 invoke 绑定只能作为非可选直接调用的被调用方",
    },
  ]);
});

test("extractSourceCommands 不把无 Tauri 来源的 invoke、core 或 call 算作命令", () => {
  const result = extractSourceCommands(
    `function invoke(command) { return command; }
const core = { invoke };
const call = core.invoke;
invoke("ordinary_invoke");
core.invoke("ordinary_core");
call("ordinary_call");`,
    "/virtual/ordinary-functions.ts",
  );

  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.dynamicInvocations, []);
  assert.deepEqual(result.unsupportedInvocations, []);
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

test("extractBundledCommands 忽略注释和较长字符串中的命令子串", () => {
  const result = extractBundledCommands(
    `// "comment_only"
const longer = "prefix-substring_only-suffix";
const exact = "exact_command";`,
    ["comment_only", "substring_only", "exact_command"],
  );

  assert.deepEqual(result.commands, ["exact_command"]);
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

test("commandSurfaceFailures 报告精确的未注册命令", () => {
  const failures = commandSurfaceFailures({
    dynamicInvocations: [],
    differences: {
      missingRegistrations: ["missing_command"],
      registeredOnly: [],
    },
  });

  assert.deepEqual(failures, ["桌面命令未注册：missing_command"]);
});

test("commandSurfaceFailures 报告精确的无消费者注册命令", () => {
  const failures = commandSurfaceFailures({
    dynamicInvocations: [],
    differences: {
      missingRegistrations: [],
      registeredOnly: ["orphan_command"],
    },
  });

  assert.deepEqual(failures, ["Tauri 注册命令没有当前消费者：orphan_command"]);
});

test("commandSurfaceFailures 报告动态调用的精确文件和行号", () => {
  const failures = commandSurfaceFailures({
    dynamicInvocations: [{ file: "/virtual/src/api.ts", line: 42 }],
    differences: {
      missingRegistrations: [],
      registeredOnly: [],
    },
  });

  assert.deepEqual(failures, [
    "桌面命令调用必须使用字符串字面量：/virtual/src/api.ts:42",
  ]);
});

test("commandSurfaceFailures 报告无法静态证明的 invoke 用法和原因", () => {
  const failures = commandSurfaceFailures({
    dynamicInvocations: [],
    unsupportedInvocations: [
      {
        file: "/virtual/src/api.ts",
        line: 24,
        reason: "invoke 别名不能重新赋值",
      },
    ],
    differences: {
      missingRegistrations: [],
      registeredOnly: [],
    },
  });

  assert.deepEqual(failures, [
    "桌面命令 invoke 用法无法静态证明（invoke 别名不能重新赋值）：/virtual/src/api.ts:24",
  ]);
});

test("commandSurfaceFailures 在注册与消费者完全相等时返回空数组", () => {
  const failures = commandSurfaceFailures({
    dynamicInvocations: [],
    differences: {
      missingRegistrations: [],
      registeredOnly: [],
    },
  });

  assert.deepEqual(failures, []);
});

test("commandSurfaceFailures 保留构建审计的两类差异", () => {
  const failures = commandSurfaceFailures({
    differences: {
      missingRegistrations: [],
      registeredOnly: [],
      bundleOnly: ["bundle_only_command"],
      sourceNotBundled: ["source_only_command"],
    },
  });

  assert.deepEqual(failures, [
    "桌面命令只存在于生产 bundle：bundle_only_command",
    "桌面源码命令未进入生产 bundle：source_only_command",
  ]);
});

test("CLI source 模式只以注册表和生产源码计算快速门禁", async () => {
  const root = await createAuditFixture({ bundle: false });

  try {
    const result = await runAudit(root, "source");

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "source",
      registeredCommands: ["alpha", "beta"],
      sourceCommands: ["alpha", "gamma"],
      dynamicInvocations: [],
      differences: {
        missingRegistrations: ["gamma"],
        registeredOnly: ["beta"],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI bundle 模式同时拒绝没有进入生产 bundle 的源码命令", async () => {
  const root = await createAuditFixture();

  try {
    const result = await runAudit(root, "bundle");

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "bundle",
      registeredCommands: ["alpha", "beta"],
      sourceCommands: ["alpha", "gamma"],
      bundledCommands: ["alpha"],
      dynamicInvocations: [],
      differences: {
        missingRegistrations: ["gamma"],
        registeredOnly: ["beta"],
        bundleOnly: [],
        sourceNotBundled: ["gamma"],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI bundle 模式在 dist/assets 缺失时给出可操作诊断", async () => {
  const root = await createAuditFixture({ bundle: false });

  try {
    const result = await runAuditWithOptions(root, "bundle", { json: false });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "桌面命令面审计失败: 生产 bundle 构建产物缺失，请先运行 Vite build\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI bundle 缺失诊断不掩盖其他文件系统错误", async () => {
  const root = await createAuditFixture({ bundle: false });

  try {
    await mkdir(join(root, "apps", "desktop", "dist"), { recursive: true });
    await writeFile(join(root, "apps", "desktop", "dist", "assets"), "file");

    const result = await runAuditWithOptions(root, "bundle", { json: false });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ENOTDIR/);
    assert.doesNotMatch(result.stderr, /构建产物缺失/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop build 在 Vite 后运行 bundle gate 并传播失败", async () => {
  const fixture = await createDesktopBuildFixture();

  try {
    const result = await run("npm", ["run", "build", "--silent"], {
      cwd: fixture.desktopDirectory,
      env: { ...process.env, BUILD_ORDER: fixture.orderFile },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.notEqual(result.code, 0);
    assert.equal(
      await readFile(fixture.orderFile, "utf8"),
      "tsc\nvite\ngate:--mode bundle\n",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI all 模式从脚本位置完整审计三集合并报告四类差异", async () => {
  const root = await createAuditFixture();

  try {
    const result = await runAudit(root, "all");

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "all",
      registeredCommands: ["alpha", "beta"],
      sourceCommands: ["alpha", "gamma"],
      bundledCommands: ["alpha"],
      dynamicInvocations: [],
      differences: {
        missingRegistrations: ["gamma"],
        registeredOnly: ["beta"],
        bundleOnly: [],
        sourceNotBundled: ["gamma"],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI 与项目门禁输出共享的命令面诊断", async () => {
  const root = await createProjectGateFixture();

  try {
    const audit = await auditDesktopCommandSurface({ root, mode: "source" });
    const expectedFailures = commandSurfaceFailures(audit);
    const cli = await runAuditWithOptions(root, "source", { json: false });
    const projectGate = await run(
      process.execPath,
      [join(root, "scripts", "check-project-quality.mjs")],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    const diagnosticLines = (output) =>
      output
        .split("\n")
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2));

    assert.deepEqual(expectedFailures, [
      `桌面命令调用必须使用字符串字面量：${join(
        root,
        "apps",
        "desktop",
        "src",
        "api",
        "commands.ts",
      )}:3`,
    ]);
    assert.equal(cli.code, 1);
    assert.deepEqual(diagnosticLines(cli.stdout), expectedFailures);
    assert.equal(projectGate.code, 1);
    assert.deepEqual(diagnosticLines(projectGate.stderr), expectedFailures);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("项目门禁把命令面审计异常转成可操作诊断", async () => {
  const root = await createProjectGateFixture();

  try {
    await writeFile(
      join(root, "apps", "desktop", "src-tauri", "src", "lib.rs"),
      "fn main() {}\n",
    );
    const projectGate = await run(
      process.execPath,
      [join(root, "scripts", "check-project-quality.mjs")],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.equal(projectGate.code, 1);
    assert.match(
      projectGate.stderr,
      /- 桌面命令面审计失败：只能存在一个可判定的 generate_handler/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("矩阵每个 internalize 理由具名引用该行 caller、职责或保护测试", async () => {
  const matrix = await readFile(
    new URL(
      "../openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md",
      import.meta.url,
    ),
    "utf8",
  );
  const rows = matrix
    .split("\n")
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells[7] === "`internalize`");

  assert.equal(rows.length, 21);
  for (const cells of rows) {
    const command = cells[0];
    const rationale = cells[8];
    const namedEvidence = [
      ...`${cells[4]} ${cells[5]} ${cells[6]}`.matchAll(/`([^`]+)`/g),
    ].map((match) => match[1]);

    assert.ok(
      namedEvidence.length > 0,
      `${command} 缺少可供理由引用的具名证据`,
    );
    assert.ok(
      namedEvidence.some((identifier) => rationale.includes(identifier)),
      `${command} 的 rationale 未具名引用该行 caller、职责或保护测试`,
    );
  }
});
