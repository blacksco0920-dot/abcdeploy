import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerConnectionDialog } from "./ServerConnectionDialog";

describe("ServerConnectionDialog", () => {
  it("没有服务器时提供购买、端口准备和回到客户端继续的官方指引", () => {
    const onOpenUrl = vi.fn().mockResolvedValue(undefined);
    render(
      <ServerConnectionDialog
        onClose={vi.fn()}
        onConnected={vi.fn()}
        onConfirm={vi.fn()}
        onOpenUrl={onOpenUrl}
        onPrepare={vi.fn()}
        open
      />,
    );

    fireEvent.click(screen.getByText("还没有服务器？查看准备方法"));
    expect(screen.getAllByText(/公网 IP/)).toHaveLength(2);
    expect(screen.getByText(/22、80、443/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "查看购买服务器说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/1207/44580",
    );
    fireEvent.click(screen.getByRole("button", { name: "查看防火墙说明" }));
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://cloud.tencent.com/document/product/1207/44577/",
    );
  });
});
