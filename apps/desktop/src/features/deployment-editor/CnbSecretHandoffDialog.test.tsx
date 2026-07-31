import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CnbSecretHandoffDialog } from "./CnbSecretHandoffDialog";
import type { ServerDeploymentAuthorizationResult } from "./server-deployment-authorization";

const handoff: ServerDeploymentAuthorizationResult = {
  inspection: {
    projectPath: "/projects/sample",
    serverId: "server-1",
  } as ServerDeploymentAuthorizationResult["inspection"],
  secretRepository: "owner/deploy-secrets",
  repositoryAccessible: true,
  secretHandoffRequired: true,
  bundle: {
    environment: "staging",
    filename: "env.sample.staging.yml",
    fileUrl:
      "https://cnb.cool/owner/deploy-secrets/-/blob/main/env.sample.staging.yml",
    content: "STAGING_SERVER_HOST: 119.91.112.80",
    missingVariables: ["API_KEY"],
    deployKeyFingerprint: "SHA256:test",
  },
};

describe("CnbSecretHandoffDialog", () => {
  it("按复制文件名、复制内容并打开网页、确认保存形成单一闭环", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const onOpenUrl = vi.fn().mockResolvedValue(undefined);
    render(
      <CnbSecretHandoffDialog
        handoff={handoff}
        onClose={vi.fn()}
        onComplete={onComplete}
        onOpenUrl={onOpenUrl}
        open
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "保存一次上线安全配置",
      }),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: "我已在 CNB 保存，继续",
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(within(dialog).getAllByRole("button", { name: "复制" })[0]);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("env.sample.staging.yml"),
    );
    fireEvent.click(within(dialog).getAllByRole("button", { name: "复制" })[0]);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "STAGING_SERVER_HOST: 119.91.112.80",
      );
      expect(onOpenUrl).toHaveBeenCalledWith(
        "https://cnb.cool/owner/deploy-secrets/-/new/main",
      );
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("用户已经在 CNB 保存时无需重复复制即可继续检查", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(
      <CnbSecretHandoffDialog
        handoff={handoff}
        onClose={vi.fn()}
        onComplete={onComplete}
        onOpenUrl={vi.fn()}
        open
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "我已在 CNB 保存，继续" }),
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("仓库不存在时先引导创建，但保留后续复制步骤避免重新填写授权", () => {
    const onOpenUrl = vi.fn().mockResolvedValue(undefined);
    render(
      <CnbSecretHandoffDialog
        handoff={{ ...handoff, repositoryAccessible: false }}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onOpenUrl={onOpenUrl}
        open
      />,
    );

    expect(screen.getByText("还没有找到这个 CNB 密钥仓库")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开 CNB 创建仓库" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看密钥仓库说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://docs.cnb.cool/zh/repo/secret.html",
    );
    expect(
      screen.getByRole("button", { name: "我已在 CNB 保存，继续" }),
    ).toBeEnabled();
  });
});
