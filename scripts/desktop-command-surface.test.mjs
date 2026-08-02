import assert from "node:assert/strict";
import {
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

test("CLI bundle 模式只以注册表和生产 bundle 计算构建后门禁", async () => {
  const root = await createAuditFixture({ source: false });

  try {
    const result = await runAudit(root, "bundle");

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "bundle",
      registeredCommands: ["alpha", "beta"],
      bundledCommands: ["alpha"],
      differences: {
        missingRegistrations: [],
        registeredOnly: ["beta"],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
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
