import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  auditDesktopCommandSurface,
  commandSurfaceFailures,
} from "./lib/desktop-command-surface.mjs";

const root = process.cwd();
const failures = [];
const requiredFiles = [
  "README.md",
  "LICENSE",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/product-contract.md",
  "docs/architecture.md",
  "docs/current-state.md",
  "docs/internal/README.md",
  "docs/internal/implementation-inventory.md",
  "docs/engineering-quality.md",
  "docs/frontend-design-guidelines.md",
  "docs/implementation-acceptance.md",
  "docs/internal/codegraph.md",
  ".editorconfig",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`缺少开源项目必需文件：${file}`);
}

if (existsSync("docs/archive")) {
  failures.push("docs/archive 不应存在；历史结论由 Git 保存");
}

const files = execFileSync("rg", ["--files"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file && existsSync(file));

const sourcePattern = /\.(?:ts|tsx|js|mjs|rs|css)$/;
const transitionalBudgets = new Map([
  ["apps/desktop/src/api.ts", 2960],
  ["apps/desktop/src-tauri/src/lib.rs", 9000],
  ["apps/desktop/src-tauri/src/tests.rs", 3020],
  ["apps/desktop/src-tauri/src/workspace.rs", 4850],
  ["apps/desktop/src-tauri/src/workspace/tests.rs", 3670],
  ["crates/deploy-core/src/render.rs", 3380],
  ["crates/deploy-core/src/plan.rs", 2090],
  ["crates/deploy-core/src/scanner.rs", 1240],
]);

for (const file of files.filter((candidate) => sourcePattern.test(candidate))) {
  const lines = lineCount(file);
  const testFile =
    /(?:\.test\.|\.spec\.)/.test(file) || file.includes("/tests/");
  const defaultBudget = file.endsWith(".rs") ? 1200 : testFile ? 1200 : 800;
  const budget = transitionalBudgets.get(file) ?? defaultBudget;
  if (lines > budget) {
    failures.push(`${file} 有 ${lines} 行，超过预算 ${budget} 行`);
  }
}

const forbiddenFiles = [
  "apps/desktop/src/components/ApplicationFrame.tsx",
  "apps/desktop/src/components/ConfigurationCenter.tsx",
  "apps/desktop/src/components/DeploymentPathWorkspace.tsx",
  "apps/desktop/src/components/DeploymentWorkflowCanvas.tsx",
  "apps/desktop/src/components/ExistingDeploymentChoice.tsx",
  "apps/desktop/src/components/RuntimeConfigFields.tsx",
  "apps/desktop/src/components/ProductWorkspace.tsx",
  "apps/desktop/src/components/ProjectHome.tsx",
  "apps/desktop/src/components/AppShell.tsx",
  "apps/desktop/src/components/ui/workspace-button.tsx",
  "apps/desktop/src/api/deployment-path-layout.ts",
  "apps/desktop/src/lib/release-model.ts",
];
for (const file of forbiddenFiles) {
  if (existsSync(file)) failures.push(`旧架构文件重新出现：${file}`);
}

const legacyDependencies = [
  "@douyinfe/semi-icons",
  "@douyinfe/semi-ui",
  "@flowgram.ai/free-layout-editor",
  "@flowgram.ai/free-snap-plugin",
];
const desktopPackage = JSON.parse(
  readFileSync("apps/desktop/package.json", "utf8"),
);
const desktopDependencies = {
  ...desktopPackage.dependencies,
  ...desktopPackage.devDependencies,
};
for (const dependency of legacyDependencies) {
  if (dependency in desktopDependencies) {
    failures.push(`旧产品形态依赖重新出现：${dependency}`);
  }
}

const frontendRuntime = files.filter(
  (file) =>
    /\.(?:ts|tsx)$/.test(file) &&
    file.startsWith("apps/desktop/src/") &&
    !/(?:\.test\.|\.spec\.)/.test(file) &&
    !file.includes("/test/"),
);
for (const file of frontendRuntime) {
  const text = readFileSync(file, "utf8");
  if (/部署测试版|发布正式版|测试版|正式版/.test(text)) {
    failures.push(`${file} 重新暴露了废弃的测试版/正式版产品模型`);
  }
  if (
    file !== "apps/desktop/src/api.ts" &&
    !file.startsWith("apps/desktop/src/api/")
  ) {
    if (/from\s+["']@tauri-apps\/api\/core["']/.test(text)) {
      failures.push(`${file} 绕过类型化 API 直接依赖 Tauri invoke`);
    }
  }
}

try {
  const commandSurface = await auditDesktopCommandSurface({
    root,
    mode: "source",
  });
  failures.push(...commandSurfaceFailures(commandSurface));
} catch (error) {
  failures.push(
    `桌面命令面审计失败：${error instanceof Error ? error.message : String(error)}`,
  );
}

checkMarkdownLinks(files.filter((file) => file.endsWith(".md")));
checkUserFacingDocumentationBoundaries();
checkFrontendReachability(frontendRuntime);
checkProjectContextRecovery();
checkDocumentationAssetConsistency(files);

if (failures.length) {
  console.error("项目质量检查失败：\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `项目质量检查通过：${files.length} 个文件，${requiredFiles.length} 个必需文档，架构预算与链接均有效。`,
);

function lineCount(file) {
  const text = readFileSync(file, "utf8");
  return text ? text.split(/\r?\n/).length : 0;
}

function checkProjectContextRecovery() {
  const currentState = "docs/current-state.md";
  const entryFiles = ["AGENTS.md", "README.md", "docs/README.md"];
  for (const file of entryFiles) {
    if (!existsSync(file)) {
      failures.push(`冷启动入口缺少文件：${file}`);
      continue;
    }
    if (!referencesCurrentState(file, currentState)) {
      failures.push(`冷启动入口缺少 ${currentState}：${file}`);
    }
  }

  if (existsSync("AGENTS.md")) {
    const agents = readFileSync("AGENTS.md", "utf8");
    const coldStart = markdownSection(agents, "一分钟冷启动");
    if (!coldStart) {
      failures.push("AGENTS.md 缺少固定章节：## 一分钟冷启动");
    } else {
      const firstStep = coldStart.match(/^1\.\s+.*$/m)?.[0] ?? "";
      const secondStep = coldStart.match(/^2\.\s+.*$/m)?.[0] ?? "";
      if (!firstStep.includes("docs/README.md")) {
        failures.push(
          "AGENTS.md 的“一分钟冷启动”第 1 步必须先指向 docs/README.md",
        );
      }
      if (!secondStep.includes(currentState)) {
        failures.push(
          `AGENTS.md 的“一分钟冷启动”第 2 步必须再指向 ${currentState}`,
        );
      }
    }
    for (const entry of ["OpenSpec", "Comet", "CodeGraph"]) {
      if (!agents.includes(entry)) {
        failures.push(`冷启动入口缺少 ${entry}：AGENTS.md`);
      }
    }
  }

  checkHistoricalPrototypeNavigation();

  if (!existsSync(currentState)) return;
  const text = readFileSync(currentState, "utf8");
  const statuses = [
    "VERIFIED",
    "IMPLEMENTED_UNVERIFIED",
    "NEXT",
    "TARGET",
    "OUT_OF_SCOPE",
  ];
  for (const status of statuses) {
    if (!text.includes(status))
      failures.push(`${currentState} 缺少状态枚举：${status}`);
  }
}

function checkDocumentationAssetConsistency(allFiles) {
  const docsIndex = "docs/README.md";
  if (existsSync(docsIndex)) {
    const linkedTargets = new Set();
    const text = readFileSync(docsIndex, "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].split("#")[0];
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue;
      linkedTargets.add(
        path.normalize(
          path.resolve(root, path.dirname(docsIndex), decodeURI(href)),
        ),
      );
    }
    const topLevelDocuments = allFiles.filter(
      (file) =>
        file.startsWith("docs/") &&
        !file.slice("docs/".length).includes("/") &&
        file.endsWith(".md"),
    );
    for (const file of topLevelDocuments) {
      if (file === docsIndex) continue;
      if (!linkedTargets.has(path.normalize(path.resolve(root, file)))) {
        failures.push(`顶层维护文档未从 ${docsIndex} 发现：${file}`);
      }
    }
  }

  const prototype = "docs/product-prototype/index.html";
  if (existsSync(prototype)) {
    const prototypeText = readFileSync(prototype, "utf8");
    for (const marker of [
      "历史讨论资产",
      "仅用于追溯",
      "不代表当前产品、实现或完成状态",
    ]) {
      if (!prototypeText.includes(marker)) {
        failures.push(`${prototype} 缺少非权威提示：${marker}`);
      }
    }
    const maintainedDocuments = [
      "README.md",
      "SECURITY.md",
      ...allFiles.filter(
        (file) =>
          file.startsWith("docs/") &&
          file.endsWith(".md") &&
          !file.startsWith("docs/comet/") &&
          !file.startsWith("docs/superpowers/"),
      ),
    ];
    const deletionClaim = /历史(?:\s+HTML)?\s*原型(?:已经|已)删除/;
    for (const file of maintainedDocuments) {
      if (!existsSync(file)) continue;
      if (deletionClaim.test(readFileSync(file, "utf8"))) {
        failures.push(`${file} 声称历史原型已删除，但 ${prototype} 仍存在`);
      }
    }
  }

  for (const file of ["AGENTS.md", "docs/README.md"]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const recoveryPath of [
      ".comet/current-change.json",
      "docs/comet/changes/",
      "openspec/changes/",
    ]) {
      if (!text.includes(recoveryPath)) {
        failures.push(`${file} 缺少 Native/Classic 恢复线索：${recoveryPath}`);
      }
    }
  }
}

function markdownSection(text, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escapedHeading}\\s*$`, "m").exec(text);
  if (!match) return null;
  const sectionStart = match.index + match[0].length;
  const remainder = text.slice(sectionStart);
  const nextSection = remainder.search(/^##\s+/m);
  return nextSection === -1 ? remainder : remainder.slice(0, nextSection);
}

function checkHistoricalPrototypeNavigation() {
  const historicalPath = "product-prototype";
  for (const file of ["AGENTS.md", "README.md"]) {
    if (!existsSync(file)) continue;
    if (readFileSync(file, "utf8").includes(historicalPath)) {
      failures.push(
        `默认冷启动入口禁止链接历史原型：${file} 包含 ${historicalPath}`,
      );
    }
  }

  const docsIndex = "docs/README.md";
  if (!existsSync(docsIndex)) return;
  const text = readFileSync(docsIndex, "utf8");
  const occurrences = [...text.matchAll(/product-prototype/g)];
  if (!occurrences.length) return;
  const historyHeading = text.match(/^## 历史追溯\s*$/m);
  const historySection = markdownSection(text, "历史追溯");
  if (!historyHeading || historySection === null) {
    failures.push(
      `${docsIndex} 包含 ${historicalPath} 链接，但缺少“## 历史追溯”章节`,
    );
    return;
  }
  const sectionStart = historyHeading.index + historyHeading[0].length;
  const sectionEnd = sectionStart + historySection.length;
  for (const occurrence of occurrences) {
    if (occurrence.index < sectionStart || occurrence.index >= sectionEnd) {
      const line = text.slice(0, occurrence.index).split(/\r?\n/).length;
      failures.push(
        `${docsIndex} 的 ${historicalPath} 历史链接只能位于“## 历史追溯”章节内：第 ${line} 行`,
      );
    }
  }
}

function referencesCurrentState(file, currentState) {
  const text = readFileSync(file, "utf8");
  if (text.includes(currentState)) return true;
  const expectedTarget = path.resolve(root, currentState);
  return [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].some((match) => {
    const href = match[1].split("#")[0];
    return (
      href &&
      path.resolve(root, path.dirname(file), decodeURI(href)) === expectedTarget
    );
  });
}

function checkUserFacingDocumentationBoundaries() {
  const productFiles = [
    "README.md",
    "docs/README.md",
    "docs/product-contract.md",
    "docs/frontend-design-guidelines.md",
  ];
  const adapterOrLegacyTerms =
    /\b(?:CNB|TCR|Caddy|Docker|Compose|FlowGram|Coze|OCI|Ubuntu|ProjectGallery|startDeploymentPath)\b|sslip\.io|公网 IP|腾讯云|Nginx|四节点|DeploymentWorkflowCanvas|DeploymentPathWorkspace|测试环境|生产环境|主机指纹|一次性密码|私钥/gi;
  const markdownOnlyAdapterTerms = /\bSSH\b/g;

  for (const file of productFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const matches = [
      ...new Set([
        ...(text.match(adapterOrLegacyTerms) ?? []),
        ...(file.endsWith(".md")
          ? (text.match(markdownOnlyAdapterTerms) ?? [])
          : []),
      ]),
    ];
    if (matches.length) {
      failures.push(
        `${file} 混入适配器或历史产品术语：${matches.join("、")}；请移入技术迁移清单`,
      );
    }
  }
}

function checkMarkdownLinks(markdownFiles) {
  for (const file of markdownFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].split("#")[0];
      if (!href || /^(?:https?:|mailto:)/.test(href)) continue;
      const target = path.resolve(root, path.dirname(file), decodeURI(href));
      if (!existsSync(target)) failures.push(`${file} 包含失效链接：${href}`);
    }
  }
}

function checkFrontendReachability(runtimeFiles) {
  const normalizedFiles = new Set(
    runtimeFiles.map((file) => path.normalize(path.resolve(file))),
  );
  const dependencies = new Map();
  for (const file of normalizedFiles) {
    const text = readFileSync(file, "utf8");
    const targets = [];
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g,
    )) {
      if (!match[1].startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), match[1]);
      const resolved = [
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ].find((candidate) => normalizedFiles.has(path.normalize(candidate)));
      if (resolved) targets.push(path.normalize(resolved));
    }
    dependencies.set(file, targets);
  }

  const entry = path.normalize(path.resolve("apps/desktop/src/main.tsx"));
  const reachable = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(dependencies.get(file) ?? []));
  }

  const allowed = new Set([
    path.normalize(path.resolve("apps/desktop/src/vite-env.d.ts")),
  ]);
  for (const file of normalizedFiles) {
    if (!reachable.has(file) && !allowed.has(file)) {
      failures.push(
        `前端运行文件无法从 main.tsx 到达：${path.relative(root, file)}`,
      );
    }
  }
}
