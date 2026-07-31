import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const excluded = new Set(["Cargo.lock", "pnpm-lock.yaml"]);
const files = execFileSync("rg", ["--files", "-0"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && !excluded.has(file));

const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ["provider-api-key", /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}\b/g],
];
const explicitlyFake = /(?:test|example|placeholder|replace|fake|demo|not-a-real)/i;
const failures = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [rule, pattern] of rules) {
    for (const match of content.matchAll(pattern)) {
      if (rule === "provider-api-key" && explicitlyFake.test(match[0])) continue;
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      const sourceLines = content.split(/\r?\n/);
      const annotation = `${sourceLines[line - 2] ?? ""}\n${sourceLines[line - 1] ?? ""}`;
      if (annotation.includes("secret-scan: allow-fixture")) continue;
      failures.push(`${file}:${line} 命中 ${rule}`);
    }
  }
}

if (failures.length) {
  console.error("跟踪文件密钥检查失败（不会打印密钥内容）：\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`跟踪文件密钥检查通过：扫描 ${files.length} 个文件，未发现高置信度凭据。`);
