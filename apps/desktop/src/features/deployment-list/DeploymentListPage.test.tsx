import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentListPage } from "./DeploymentListPage";
import type { DeploymentListItem } from "./model";

const deployments: DeploymentListItem[] = [
  {
    additionalAddressCount: 2,
    currentResult: { kind: "success", label: "上线成功" },
    environmentName: "云服务器 A",
    id: "sample-store-server",
    lastVerifiedLabel: "刚刚",
    primaryAddress: "https://shop.example.com",
    projectName: "sample-store",
  },
  {
    currentResult: { kind: "stale", label: "上次验证通过 · 待复查" },
    environmentName: "这台电脑",
    id: "admin-local",
    lastVerifiedLabel: "6 分钟前",
    projectName: "admin",
  },
];

describe("DeploymentListPage", () => {
  it("只展示部署合同规定的列表事实，并把新建和打开交给调用方", () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    render(
      <DeploymentListPage
        items={deployments}
        onCreate={onCreate}
        onOpen={onOpen}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "我的部署" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("小白部署 ABCDeploy")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "部署列表" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    const serverRow = rows[0];
    expect(within(serverRow).getByText("sample-store")).toBeInTheDocument();
    expect(within(serverRow).getByText("云服务器 A")).toBeInTheDocument();
    expect(within(serverRow).getByText("上线成功")).toBeInTheDocument();
    expect(
      within(serverRow).getByText("https://shop.example.com"),
    ).toBeInTheDocument();
    expect(within(serverRow).getByText("另有 2 个地址")).toBeInTheDocument();
    expect(within(serverRow).getByText("最近验证：刚刚")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建部署" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(serverRow).getByRole("button", {
        name: "打开 sample-store（云服务器 A）",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(deployments[0]);
  });

  it("只有当前验证成功使用成功状态，过期证据保持中性", () => {
    render(
      <DeploymentListPage
        items={deployments}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("上线成功")).toHaveAttribute(
      "data-result-tone",
      "success",
    );
    expect(screen.getByText("上次验证通过 · 待复查")).toHaveAttribute(
      "data-result-tone",
      "neutral",
    );
  });

  it("不提供搜索、筛选、配置中心或 Provider 入口", () => {
    render(
      <DeploymentListPage
        items={deployments}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText(/搜索|筛选|配置中心/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Provider|代码托管|构建平台|镜像仓库/),
    ).not.toBeInTheDocument();
  });

  it("空状态只有新建部署一个操作", () => {
    const onCreate = vi.fn();
    render(
      <DeploymentListPage items={[]} onCreate={onCreate} onOpen={vi.fn()} />,
    );

    expect(
      screen.getByRole("heading", { name: "还没有部署" }),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("新建部署");
    fireEvent.click(buttons[0]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("移除部署记录前明确影响范围并要求确认", () => {
    const onRemove = vi.fn();
    render(
      <DeploymentListPage
        items={deployments}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "更多操作：sample-store" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "移除部署记录" }));

    expect(
      screen.getByRole("heading", { name: "移除 sample-store 的部署记录？" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不会删除项目文件、服务器或已保存的公共连接/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认移除部署记录" }));
    expect(onRemove).toHaveBeenCalledWith(deployments[0]);
  });
});
