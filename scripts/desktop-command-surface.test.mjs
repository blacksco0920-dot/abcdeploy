import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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

test("CLI 从脚本位置审计仓库并以稳定 JSON 报告四类差异", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-command-surface-"));

  try {
    await mkdir(join(root, "scripts", "lib"), { recursive: true });
    await mkdir(join(root, "apps", "desktop", "src-tauri", "src"), {
      recursive: true,
    });
    await mkdir(join(root, "apps", "desktop", "src"), { recursive: true });
    await mkdir(join(root, "apps", "desktop", "dist", "assets"), {
      recursive: true,
    });
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
    await symlink(
      fileURLToPath(new URL("../apps/desktop/node_modules", import.meta.url)),
      join(root, "apps", "desktop", "node_modules"),
      "dir",
    );
    await writeFile(
      join(root, "apps", "desktop", "src", "commands.ts"),
      `import { invoke } from "@tauri-apps/api/core";
invoke("gamma");
invoke("alpha");
invoke("gamma");
`,
    );
    await writeFile(
      join(root, "apps", "desktop", "src-tauri", "src", "lib.rs"),
      "tauri::generate_handler![beta, alpha, beta]",
    );
    await writeFile(
      join(root, "apps", "desktop", "dist", "assets", "index.js"),
      'const command = "alpha";',
    );

    const result = await run(
      process.execPath,
      [
        join(root, "scripts", "check-desktop-command-surface.mjs"),
        "--mode",
        "all",
        "--json",
      ],
      { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] },
    );

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
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
