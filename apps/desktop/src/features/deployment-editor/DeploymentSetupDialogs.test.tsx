import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentSetupDialogs } from "./DeploymentSetupDialogs";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";

const inspection = {
  paths: [],
  autoCompleted: false,
  issue: "choose_connections",
  projectPath: "/tmp/FinAgentCRM",
  projectName: "FinAgentCRM",
  serverId: "server-1",
  defaultAddress: "",
  defaultRoutes: [],
  publicServices: [],
  serverOptions: [
    { id: "server-1", name: "运行服务器", detail: "119.91.112.80 · ubuntu" },
  ],
  sourceOptions: [{ id: "cnb-1", name: "我的 CNB", detail: "CNB" }],
  registryOptions: [{ id: "tcr-1", name: "腾讯云 TCR", detail: "个人版" }],
  selectedSourceConnectionId: "cnb-1",
  selectedRegistryConnectionId: "tcr-1",
  needsSourceAuthorization: false,
  needsRegistryAuthorization: false,
} satisfies ServerDeploymentSetupInspection;

function services() {
  return {
    openAddress: vi.fn().mockResolvedValue(undefined),
    saveServerDeploymentSetup: vi.fn().mockResolvedValue(undefined),
    saveServerDeploymentAddress: vi.fn().mockResolvedValue(undefined),
    inspectServerDeploymentSetup: vi.fn().mockResolvedValue({
      ...inspection,
      issue: null,
      defaultRoutes: [{ service: "web", host: "shop.example.com", path: "/" }],
      publicServices: [{ id: "web", name: "网页服务", detail: "网页服务" }],
    }),
  } as unknown as DeploymentEditorServices;
}

describe("DeploymentSetupDialogs", () => {
  it("首次配置保存后自动续跑同一轮上线任务", async () => {
    const onResolved = vi.fn().mockResolvedValue(undefined);
    render(
      <DeploymentSetupDialogs
        addressRequired={false}
        inspection={inspection}
        mode="initial"
        onClose={vi.fn()}
        onResolved={onResolved}
        open
        services={services()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "准备并继续" }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(true));
  });

  it("维护模式保存后只返回详情，不启动上线", async () => {
    const onResolved = vi.fn().mockResolvedValue(undefined);
    render(
      <DeploymentSetupDialogs
        addressRequired={false}
        inspection={inspection}
        mode="settings"
        onClose={vi.fn()}
        onResolved={onResolved}
        open
        services={services()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修改部署设置" }));
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认访问地址" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "部署设置" })).toBeVisible(),
    );
    expect(onResolved).not.toHaveBeenCalled();

    expect(screen.getByLabelText("网页服务访问地址")).toHaveValue(
      "shop.example.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存为下次上线设置" }));

    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ issue: null }),
      ),
    );
  });

  it("维护模式从访问地址返回时回到包含四类信息的总摘要", async () => {
    const onResolved = vi.fn().mockResolvedValue(undefined);
    render(
      <DeploymentSetupDialogs
        addressRequired={false}
        inspection={inspection}
        mode="settings"
        onClose={vi.fn()}
        onResolved={onResolved}
        open
        services={services()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "修改部署设置" }));
    fireEvent.click(
      screen.getByRole("button", { name: "下一步：确认访问地址" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("网页服务访问地址")).toHaveValue(
        "shop.example.com",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "返回部署设置" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "修改部署设置" }),
      ).toBeVisible(),
    );
    expect(screen.getByText("访问地址")).toBeVisible();
    expect(screen.getByText("shop.example.com")).toBeVisible();
    expect(onResolved).not.toHaveBeenCalled();
  });
});
