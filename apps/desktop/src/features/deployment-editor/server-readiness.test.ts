import { describe, expect, it } from "vitest";
import { serverReadinessFailure } from "./server-readiness";

describe("serverReadinessFailure", () => {
  it("把服务器重装后的身份变化归为重新连接", () => {
    expect(
      serverReadinessFailure(new Error("AD-ENV-205：服务器身份已经变化")),
    ).toMatchObject({
      action: "reconnect",
      actionLabel: "重新连接服务器",
    });
  });

  it("把空服务器归为客户端可自动准备的状态", () => {
    expect(
      serverReadinessFailure(new Error("AD-ENV-207：Docker 尚未安装")),
    ).toMatchObject({
      action: "prepare_runtime",
      actionLabel: "自动准备服务器",
      message:
        "服务器已经连接，但运行项目所需的环境还没有准备好。 ABCDeploy 可以自动安装并启动所需环境。",
    });
  });

  it("自动准备失败后保留同一条恢复路径", () => {
    expect(
      serverReadinessFailure(
        new Error("AD-SRV-104：登录用户没有免密 sudo 权限"),
      ),
    ).toMatchObject({
      action: "prepare_runtime",
      actionLabel: "重试自动准备",
    });
  });
});
