import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
  const testFile = /(?:\.test\.|\.spec\.)/.test(file) || file.includes("/tests/");
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
const desktopPackage = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"));
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
  if (file !== "apps/desktop/src/api.ts" && !file.startsWith("apps/desktop/src/api/")) {
    if (/from\s+["']@tauri-apps\/api\/core["']/.test(text)) {
      failures.push(`${file} 绕过类型化 API 直接依赖 Tauri invoke`);
    }
  }
}

checkMarkdownLinks(files.filter((file) => file.endsWith(".md")));
checkUserFacingDocumentationBoundaries();
checkFrontendReachability(frontendRuntime);
checkProjectContextRecovery();

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
    if (!text.includes(status)) failures.push(`${currentState} 缺少状态枚举：${status}`);
  }
}

function checkUserFacingDocumentationBoundaries() {
  const productFiles = [
    "README.md",
    "docs/README.md",
    "docs/product-contract.md",
    "docs/frontend-design-guidelines.md",
  ];
  const adapterOrLegacyTerms = /\b(?:CNB|TCR|Caddy|Docker|Compose|FlowGram|Coze|OCI|Ubuntu|ProjectGallery|startDeploymentPath)\b|sslip\.io|公网 IP|腾讯云|Nginx|四节点|DeploymentWorkflowCanvas|DeploymentPathWorkspace|测试环境|生产环境|主机指纹|一次性密码|私钥/gi;
  const markdownOnlyAdapterTerms = /\bSSH\b/g;

  for (const file of productFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const matches = [...new Set([
      ...(text.match(adapterOrLegacyTerms) ?? []),
      ...(file.endsWith(".md") ? text.match(markdownOnlyAdapterTerms) ?? [] : []),
    ])];
    if (matches.length) {
      failures.push(`${file} 混入适配器或历史产品术语：${matches.join("、")}；请移入技术迁移清单`);
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
  const normalizedFiles = new Set(runtimeFiles.map((file) => path.normalize(path.resolve(file))));
  const dependencies = new Map();
  for (const file of normalizedFiles) {
    const text = readFileSync(file, "utf8");
    const targets = [];
    for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
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

  const allowed = new Set([path.normalize(path.resolve("apps/desktop/src/vite-env.d.ts"))]);
  for (const file of normalizedFiles) {
    if (!reachable.has(file) && !allowed.has(file)) {
      failures.push(`前端运行文件无法从 main.tsx 到达：${path.relative(root, file)}`);
    }
  }
}
