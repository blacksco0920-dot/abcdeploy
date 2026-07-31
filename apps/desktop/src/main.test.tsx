import { StrictMode, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const rootRender = vi.hoisted(() => vi.fn());

vi.mock("react-dom/client", () => {
  const createRoot = () => ({ render: rootRender });
  return {
    createRoot,
    default: { createRoot },
  };
});

vi.mock("./App", () => ({
  default: () => <div>ABCDeploy</div>,
}));

describe("desktop application root", () => {
  beforeAll(async () => {
    await import("./main");
  });

  it("keeps the application root inside StrictMode", () => {
    expect(rootRender).toHaveBeenCalledTimes(1);
    const root = rootRender.mock.calls[0]?.[0] as ReactElement;
    expect(root.type).toBe(StrictMode);
  });
});
