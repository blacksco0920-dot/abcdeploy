import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NecessaryConfigurationDialog } from "./NecessaryConfigurationDialog";

const content = [
  "# 数据库连接地址",
  "DATABASE_URL=postgres://localhost/app",
  "# 访问令牌",
  "ACCESS_TOKEN=",
  "OPTIONAL_FLAG=on",
  "PLAIN_REQUIRED=",
  "unknown line that must stay",
].join("\n");

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof NecessaryConfigurationDialog>
  > = {},
) {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <NecessaryConfigurationDialog
      content={content}
      onCancel={onCancel}
      onSave={onSave}
      open
      requiredVariables={["DATABASE_URL", "ACCESS_TOKEN", "PLAIN_REQUIRED"]}
      {...overrides}
    />,
  );
  return { onCancel, onSave };
}

describe("NecessaryConfigurationDialog", () => {
  it("默认只展示本次待填写配置，并明确其他配置不会阻塞上线", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "补全本次上线配置" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("访问令牌")).toBeInTheDocument();
    expect(within(dialog).getByText("ACCESS_TOKEN")).toBeInTheDocument();
    expect(within(dialog).getByText("PLAIN_REQUIRED")).toBeInTheDocument();
    expect(
      within(dialog).queryByText("数据库连接地址"),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("OPTIONAL_FLAG")).not.toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "查看其他配置" }),
    );
    expect(within(dialog).getByText("数据库连接地址")).toBeInTheDocument();
    expect(within(dialog).getByText("DATABASE_URL")).toBeInTheDocument();
    expect(within(dialog).getByText("OPTIONAL_FLAG")).toBeInTheDocument();
  });

  it("秘密字段使用密码输入，普通字段不重复展示英文副标题", () => {
    renderDialog();

    expect(screen.getByLabelText("访问令牌")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("PLAIN_REQUIRED")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getAllByText("PLAIN_REQUIRED")).toHaveLength(1);
  });

  it("准确显示缺值数量，填完整后保存保留原文并只更新填写项", () => {
    const { onSave } = renderDialog();
    const save = screen.getByRole("button", { name: "保存并继续上线" });

    expect(
      screen.getByText("本次上线还需填写 2 项；其他配置不会阻塞本次上线。"),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("访问令牌"), {
      target: { value: "secret-token" },
    });
    expect(
      screen.getByText("本次上线还需填写 1 项；其他配置不会阻塞本次上线。"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PLAIN_REQUIRED"), {
      target: { value: "ready" },
    });

    expect(
      screen.getByText("本次上线需要的配置已填写完整。"),
    ).toBeInTheDocument();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      [
        "# 数据库连接地址",
        "DATABASE_URL=postgres://localhost/app",
        "# 访问令牌",
        "ACCESS_TOKEN=secret-token",
        "OPTIONAL_FLAG=on",
        "PLAIN_REQUIRED=ready",
        "unknown line that must stay",
      ].join("\n"),
    );
  });

  it("缺少的必要配置会在保存时追加，取消不会保存", () => {
    const { onCancel, onSave } = renderDialog({
      content: "# 已知配置\nKNOWN=value\n",
      requiredVariables: ["NEW_REQUIRED"],
    });

    fireEvent.change(screen.getByLabelText("NEW_REQUIRED"), {
      target: { value: "new-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续上线" }));
    expect(onSave).toHaveBeenCalledWith(
      "# 已知配置\nKNOWN=value\nNEW_REQUIRED=new-value\n",
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("关闭时不渲染对话框，且文案不引入旧概念", () => {
    const view = renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.onCancel.mockClear();

    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent(/环境|Provider/i);
  });
});
