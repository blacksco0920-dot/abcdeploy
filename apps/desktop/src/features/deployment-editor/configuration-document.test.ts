import { describe, expect, it } from "vitest";
import {
  isSecretConfigurationKey,
  parseConfigurationDocument,
  updateConfigurationDocument,
} from "./configuration-document";

describe("configuration document", () => {
  it("把紧邻注释作为标题，并合并尚未出现在文档里的必要配置", () => {
    const fields = parseConfigurationDocument(
      [
        "# 数据库连接地址",
        "DATABASE_URL=postgres://localhost/app",
        "",
        "# 不再紧邻配置",
        "",
        "APP_PORT=3000",
      ].join("\n"),
      ["DATABASE_URL", "APP_SECRET", "APP_SECRET"],
    );

    expect(fields).toEqual([
      {
        key: "DATABASE_URL",
        required: true,
        secret: false,
        title: "数据库连接地址",
        value: "postgres://localhost/app",
      },
      {
        key: "APP_PORT",
        required: false,
        secret: false,
        title: "APP_PORT",
        value: "3000",
      },
      {
        key: "APP_SECRET",
        required: true,
        secret: true,
        title: "APP_SECRET",
        value: "",
      },
    ]);
  });

  it("识别常见秘密字段，但不会把普通英文单词误判为秘密", () => {
    expect(isSecretConfigurationKey("JWT_SECRET")).toBe(true);
    expect(isSecretConfigurationKey("API_TOKEN")).toBe(true);
    expect(isSecretConfigurationKey("SSH_PRIVATE_KEY")).toBe(true);
    expect(isSecretConfigurationKey("MONKEY_NAME")).toBe(false);
    expect(isSecretConfigurationKey("PUBLIC_SITE_URL")).toBe(false);
  });

  it("只更新目标赋值并补充新键，保留注释、顺序、未知行和换行风格", () => {
    const content = [
      "# 数据库连接地址",
      "DATABASE_URL=postgres://old",
      "source ./shared-config",
      "export APP_PORT = 3000",
      "# 未知内容保持原样",
      "",
    ].join("\r\n");

    expect(
      updateConfigurationDocument(content, {
        APP_PORT: "8080",
        DATABASE_URL: "postgres://new/path?mode=rw",
        NEW_TOKEN: "token=value",
      }),
    ).toBe(
      [
        "# 数据库连接地址",
        "DATABASE_URL=postgres://new/path?mode=rw",
        "source ./shared-config",
        "export APP_PORT = 8080",
        "# 未知内容保持原样",
        "NEW_TOKEN=token=value",
        "",
      ].join("\r\n"),
    );
  });

  it("没有变更时逐字返回原文", () => {
    const content = '# 配置\nVALUE="a value"\n';
    expect(updateConfigurationDocument(content, {})).toBe(content);
  });
});
