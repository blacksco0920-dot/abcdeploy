import { describe, expect, it } from "vitest";
import tauriConfig from "../src-tauri/tauri.conf.json";

describe("desktop window accessibility", () => {
  it("fits a 1440 × 960 display at 200% scaling", () => {
    const mainWindow = tauriConfig.app.windows[0];

    expect(mainWindow.minWidth).toBeLessThanOrEqual(720);
    expect(mainWindow.minHeight).toBeLessThanOrEqual(480);
    expect(mainWindow.width).toBeGreaterThanOrEqual(mainWindow.minWidth);
    expect(mainWindow.height).toBeGreaterThanOrEqual(mainWindow.minHeight);
  });

  it("keeps the MVP flow usable at the minimum supported width", () => {
    const mainWindow = tauriConfig.app.windows[0];

    expect(mainWindow.minWidth).toBeLessThan(760);
    expect(mainWindow.minHeight).toBeLessThanOrEqual(480);
  });
});
