import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerDeploymentSetupDialog } from "./ServerDeploymentSetupDialog";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";

describe("ServerDeploymentSetupDialog", () => {
  it("后续维护复用首次上线设置，保存后不会暗示立即上线", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServerDeploymentSetupDialog
        inspection={
          {
            issue: null,
            projectName: "FinAgentCRM",
            sourceOptions: [{ id: "cnb-1", name: "我的 CNB", detail: "CNB" }],
            registryOptions: [
              { id: "tcr-1", name: "腾讯云 TCR", detail: "个人版" },
            ],
            serverOptions: [
              {
                id: "server-1",
                name: "运行服务器",
                detail: "119.91.112.80 · ubuntu",
              },
            ],
            selectedSourceConnectionId: "cnb-1",
            selectedRegistryConnectionId: "tcr-1",
            serverId: "server-1",
            defaultRoutes: [
              {
                service: "web",
                host: "finagentcrm.example.com",
                path: "/",
              },
            ],
            publicServices: [
              { id: "web", name: "网页服务", detail: "网页服务" },
            ],
            needsSourceAuthorization: false,
            needsRegistryAuthorization: false,
          } as unknown as ServerDeploymentSetupInspection
        }
        mode="settings"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={onSave}
        open
      />,
    );

    expect(
      screen.getByRole("heading", { name: "部署设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "首次上线时建立的同一套设置。默认只读；点击修改后按“部署资源 → 访问地址”两步完成。保存只影响下次更新上线，当前在线版本不变。",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("listitem", { name: "1 部署资源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/不会启动构建、部署、重启服务或替换当前在线版本/),
    ).toBeInTheDocument();
    expect(screen.getByText("我的 CNB")).toBeVisible();
    expect(screen.getByText("腾讯云 TCR")).toBeVisible();
    expect(screen.getByText("119.91.112.80 · ubuntu")).toBeVisible();
    expect(screen.getByText("访问地址")).toBeVisible();
    expect(screen.getByText("finagentcrm.example.com")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改部署设置" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "下一步：确认访问地址" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "关闭" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "修改部署设置" }));
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认访问地址" }),
    );

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("cnb-1", "tcr-1", "server-1"),
    );
  });

  it("后续维护只有明确点击修改后才展示连接选择器", () => {
    render(
      <ServerDeploymentSetupDialog
        inspection={
          {
            issue: null,
            projectName: "FinAgentCRM",
            sourceOptions: [{ id: "cnb-1", name: "我的 CNB", detail: "CNB" }],
            registryOptions: [
              { id: "tcr-1", name: "腾讯云 TCR", detail: "个人版" },
            ],
            serverOptions: [
              {
                id: "server-1",
                name: "运行服务器",
                detail: "119.91.112.80 · ubuntu",
              },
            ],
            selectedSourceConnectionId: "cnb-1",
            selectedRegistryConnectionId: "tcr-1",
            serverId: "server-1",
            needsSourceAuthorization: false,
            needsRegistryAuthorization: false,
          } as unknown as ServerDeploymentSetupInspection
        }
        mode="settings"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        open
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修改部署设置" }));

    expect(screen.getByText("后续维护")).toBeVisible();
    expect(screen.getByText("同一套部署设置")).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "生成运行版本" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "保存运行版本" }),
    ).toBeVisible();
    expect(screen.getByRole("combobox", { name: "运行服务器" })).toBeVisible();
  });

  it("首次接入只展示用户必须提供的信息，并解释平台外准备步骤", () => {
    const openProviderSetup = vi.fn().mockResolvedValue(undefined);
    render(
      <ServerDeploymentSetupDialog
        inspection={
          {
            issue: "missing_connections",
            projectName: "FinAgentCRM",
            sourceOptions: [],
            registryOptions: [],
            needsSourceAuthorization: true,
            needsRegistryAuthorization: true,
          } as unknown as ServerDeploymentSetupInspection
        }
        onAuthorize={vi.fn()}
        onClose={vi.fn()}
        onOpenProviderSetup={openProviderSetup}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        open
      />,
    );

    expect(screen.getByText(/系统会自动创建私有代码仓库/)).toBeInTheDocument();
    expect(screen.getByText("首次上线设置")).toBeVisible();
    expect(screen.getByText("只显示当前需要你确认的内容")).toBeVisible();
    expect(screen.getByLabelText("CNB 访问令牌")).toBeInTheDocument();
    expect(screen.getByLabelText("版本仓库命名空间")).toHaveValue("abcdeploy");
    expect(screen.getByLabelText("版本仓库用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("版本仓库访问密码")).toBeInTheDocument();
    expect(screen.queryByLabelText("CNB 代码仓库")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("版本仓库地址")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("安全配置保存位置（CNB 密钥仓库）"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("还没有 CNB？查看准备方法"));
    fireEvent.click(screen.getByRole("button", { name: "查看 CNB 令牌说明" }));
    expect(openProviderSetup).toHaveBeenCalledWith(
      "https://docs.cnb.cool/zh/guide/access-token.html",
    );

    fireEvent.click(screen.getByText("还没有版本仓库？查看准备方法"));
    fireEvent.click(screen.getByRole("button", { name: "查看 TCR 开通说明" }));
    expect(openProviderSetup).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/1141/57780",
    );
  });

  it("首次配置选择可复用连接后用准备并继续完成当前任务", () => {
    render(
      <ServerDeploymentSetupDialog
        inspection={
          {
            issue: "choose_connections",
            projectName: "FinAgentCRM",
            sourceOptions: [{ id: "cnb-1", name: "我的 CNB", detail: "CNB" }],
            registryOptions: [
              { id: "tcr-1", name: "腾讯云 TCR", detail: "个人版" },
            ],
            selectedSourceConnectionId: "cnb-1",
            selectedRegistryConnectionId: "tcr-1",
            needsSourceAuthorization: false,
            needsRegistryAuthorization: false,
          } as unknown as ServerDeploymentSetupInspection
        }
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        open
      />,
    );

    expect(
      screen.getByRole("button", { name: "准备并继续" }),
    ).toBeInTheDocument();
  });

  it("维护模式需要重新授权时主动作说明授权后继续确认", () => {
    render(
      <ServerDeploymentSetupDialog
        inspection={
          {
            issue: "missing_connections",
            projectName: "FinAgentCRM",
            sourceOptions: [],
            registryOptions: [],
            needsSourceAuthorization: true,
            needsRegistryAuthorization: false,
          } as unknown as ServerDeploymentSetupInspection
        }
        mode="settings"
        onAuthorize={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        open
      />,
    );

    expect(
      screen.getByRole("button", { name: "更新授权并继续" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "准备并继续" }),
    ).not.toBeInTheDocument();
  });
});
