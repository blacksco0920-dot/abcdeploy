import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerAddressDialog } from "./ServerAddressDialog";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";

const inspection: ServerDeploymentSetupInspection = {
  paths: [],
  autoCompleted: false,
  issue: "missing_address",
  projectName: "sample-store",
  sourceOptions: [],
  registryOptions: [],
  serverOptions: [],
  selectedSourceConnectionId: "source-1",
  selectedRegistryConnectionId: "registry-1",
  projectPath: "/projects/sample-store",
  serverId: "server-1",
  defaultAddress: "https://sample-store-web.119-91-112-80.sslip.io",
  defaultRoutes: [
    {
      service: "web",
      host: "sample-store-web.119-91-112-80.sslip.io",
      path: "/",
    },
    { service: "api", host: "", path: "/" },
  ],
  publicServices: [
    { id: "web", name: "网页服务", detail: "网页服务" },
    { id: "api", name: "接口服务", detail: "接口服务" },
  ],
};

describe("ServerAddressDialog", () => {
  it("在当前步骤列出每个公网服务的地址，保存后只继续上线", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServerAddressDialog
        inspection={inspection}
        onClose={vi.fn()}
        onSave={onSave}
        open
      />,
    );

    expect(
      screen.getByRole("heading", { name: "设置项目访问地址" }),
    ).toBeVisible();
    expect(screen.getByText("首次上线设置")).toBeVisible();
    expect(
      screen.getByRole("listitem", { name: "2 访问地址" }),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByLabelText("网页服务访问地址")).toHaveValue(
      "sample-store-web.119-91-112-80.sslip.io",
    );
    expect(
      screen.getByRole("button", { name: "保存并继续上线" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText("接口服务访问地址"), {
      target: { value: "https://api.example.com/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续上线" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        {
          service: "web",
          host: "sample-store-web.119-91-112-80.sslip.io",
          path: "/",
        },
        { service: "api", host: "api.example.com", path: "/" },
      ]),
    );
  });

  it("服务器已确认拦截临时域名时说明只需填写已备案域名", () => {
    const onOpenUrl = vi.fn().mockResolvedValue(undefined);
    render(
      <ServerAddressDialog
        inspection={{
          ...inspection,
          requiresRegisteredDomain: true,
          defaultAddress: "",
          defaultRoutes: inspection.defaultRoutes.map((route) => ({
            ...route,
            host: "",
          })),
        }}
        onClose={vi.fn()}
        onOpenUrl={onOpenUrl}
        onSave={vi.fn()}
        open
      />,
    );

    expect(
      screen.getByText(
        "这台服务器不接受系统生成的临时域名。请为每个服务填写已备案域名；保存后只继续配置访问入口和验证。",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("网页服务访问地址")).toHaveValue("");
    expect(screen.getByLabelText("接口服务访问地址")).toHaveValue("");

    fireEvent.click(screen.getByText("还没有域名？查看准备方法"));
    fireEvent.click(screen.getByRole("button", { name: "查看域名注册说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/242/9595",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看备案说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/243/39038",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看域名解析说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/302/3449",
    );
  });

  it("维护模式从部署资源直接进入地址编辑，不再重复展示第二层摘要", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    render(
      <ServerAddressDialog
        inspection={{
          ...inspection,
          defaultRoutes: [
            {
              service: "web",
              host: "sample-store.example.com",
              path: "/",
            },
          ],
          publicServices: [{ id: "web", name: "网页服务", detail: "网页服务" }],
        }}
        mode="settings"
        onBack={onBack}
        onClose={vi.fn()}
        onSave={onSave}
        open
      />,
    );

    expect(screen.getByRole("heading", { name: "部署设置" })).toBeVisible();
    expect(
      screen.getByRole("listitem", { name: "2 访问地址" }),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/当前在线版本不变/)).toBeVisible();
    expect(screen.getByLabelText("网页服务访问地址")).toHaveValue(
      "sample-store.example.com",
    );
    expect(
      screen.queryByRole("button", { name: "修改访问地址" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存为下次上线设置" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "保存为下次上线设置" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        {
          service: "web",
          host: "sample-store.example.com",
          path: "/",
        },
      ]),
    );
  });

  it("维护模式从地址步骤返回部署设置总摘要", () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(
      <ServerAddressDialog
        inspection={{
          ...inspection,
          defaultRoutes: [
            {
              service: "web",
              host: "sample-store.example.com",
              path: "/",
            },
          ],
          publicServices: [{ id: "web", name: "网页服务", detail: "网页服务" }],
        }}
        mode="settings"
        onBack={onBack}
        onClose={onClose}
        onSave={vi.fn()}
        open
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回部署设置" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
