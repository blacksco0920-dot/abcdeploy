import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "abcdeploy-codegraph-"));
const temporaryIndex = path.join(temporaryDirectory, "index");
const realIndex = path.resolve(
  root,
  execFileSync("git", ["rev-parse", "--git-path", "index"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
);
const errorLog = path.join(root, ".codegraph", "errors.log");

try {
  copyFileSync(realIndex, temporaryIndex);
  const environment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  execFileSync("git", ["add", "-A"], { cwd: root, env: environment, stdio: "inherit" });
  rmSync(errorLog, { force: true });
  execFileSync("codegraph", ["index", "--force", ".", "--quiet"], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (existsSync(errorLog)) {
    throw new Error(`CodeGraph 存在解析错误：\n${readFileSync(errorLog, "utf8")}`);
  }
  execFileSync("codegraph", ["status", "."], { cwd: root, stdio: "inherit" });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
