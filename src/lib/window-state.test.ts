/**
 * window-state.ts のユニットテスト
 *
 * 一時ファイルは `tmpdir()` 配下の使い捨てディレクトリに作る。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  NO_GIT_ROOT_KEY,
  DEFAULT_BOUNDS,
  clampBoundsToDisplays,
  createWindowStateSaver,
  getBoundsForKey,
  loadWindowStateStore,
  resolveStateKey,
  saveBoundsForKey,
  type WindowBounds,
} from "./window-state";

let tmpDir: string;
let stateFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mado-window-state-"));
  stateFile = path.join(tmpDir, "window-state.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadWindowStateStore", () => {
  test("ファイル不在 → 空ストア", () => {
    const store = loadWindowStateStore(stateFile);
    expect(store).toEqual({});
  });

  test("正常 JSON → パース結果", () => {
    const data = {
      "/repo/a": { width: 800, height: 600, x: 10, y: 20 },
    };
    writeFileSync(stateFile, JSON.stringify(data));
    const store = loadWindowStateStore(stateFile);
    expect(store["/repo/a"]).toEqual({ width: 800, height: 600, x: 10, y: 20 });
  });

  test("不正 JSON → 空ストア + corrupt 退避ファイル生成", () => {
    writeFileSync(stateFile, "{ not valid json");
    const store = loadWindowStateStore(stateFile);
    expect(store).toEqual({});
    const corrupt = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupt.length).toBe(1);
  });

  test("スキーマ違反（width が負） → 空ストア + corrupt 退避", () => {
    const data = { "/repo/a": { width: -1, height: 600, x: 0, y: 0 } };
    writeFileSync(stateFile, JSON.stringify(data));
    const store = loadWindowStateStore(stateFile);
    expect(store).toEqual({});
    const corrupt = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupt.length).toBe(1);
  });
});

describe("getBoundsForKey", () => {
  test("存在するキー → bounds を返す", () => {
    const store = { "/repo/a": { width: 800, height: 600, x: 10, y: 20 } };
    expect(getBoundsForKey(store, "/repo/a")).toEqual({
      width: 800,
      height: 600,
      x: 10,
      y: 20,
    });
  });

  test("存在しないキー → null", () => {
    expect(getBoundsForKey({}, "/repo/a")).toBeNull();
  });
});

describe("saveBoundsForKey (atomic write)", () => {
  test("新規キーを保存するとファイルに反映される", () => {
    const bounds: WindowBounds = { width: 800, height: 600, x: 10, y: 20 };
    saveBoundsForKey("/repo/a", bounds, stateFile);
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"]).toEqual(bounds);
  });

  test("既存キーを上書きしても他キーは保持される", () => {
    saveBoundsForKey("/repo/a", { width: 800, height: 600, x: 0, y: 0 }, stateFile);
    saveBoundsForKey("/repo/b", { width: 900, height: 700, x: 5, y: 5 }, stateFile);
    saveBoundsForKey("/repo/a", { width: 1200, height: 800, x: 0, y: 0 }, stateFile);
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"].width).toBe(1200);
    expect(raw["/repo/b"].width).toBe(900);
  });

  test("tmp ファイルが残らない", () => {
    saveBoundsForKey("/repo/a", { width: 800, height: 600, x: 0, y: 0 }, stateFile);
    const leftovers = readdirSync(tmpDir).filter((f) => f.includes(".tmp-"));
    expect(leftovers.length).toBe(0);
  });

  test("連続保存で JSON が破損しない", () => {
    for (let i = 0; i < 50; i++) {
      saveBoundsForKey(
        "/repo/a",
        { width: 800 + i, height: 600, x: 0, y: 0 },
        stateFile,
      );
    }
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"].width).toBe(849);
  });

  test("maximized フラグを保存・読み込みできる", () => {
    saveBoundsForKey(
      "/repo/a",
      { width: 800, height: 600, x: 10, y: 20, maximized: true },
      stateFile,
    );
    const store = loadWindowStateStore(stateFile);
    expect(store["/repo/a"]?.maximized).toBe(true);
  });

  test("保存成功時に古い corrupt ファイルは最新 1 件を残して削除される", () => {
    // 古い corrupt ファイルを 3 件作る
    for (let i = 0; i < 3; i++) {
      writeFileSync(path.join(tmpDir, `window-state.json.corrupt.${i}`), "x");
    }
    saveBoundsForKey("/repo/a", { width: 800, height: 600, x: 0, y: 0 }, stateFile);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBeLessThanOrEqual(1);
  });
});

describe("clampBoundsToDisplays", () => {
  const display = {
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  };

  test("完全に画面内 → そのまま返す", () => {
    const b: WindowBounds = { width: 800, height: 600, x: 100, y: 100 };
    expect(clampBoundsToDisplays(b, [display])).toEqual(b);
  });

  test("80px 以上重なっていればそのまま返す", () => {
    const b: WindowBounds = { width: 800, height: 600, x: -700, y: 100 };
    // 重なり幅 = 100, 高さ = 600 → OK
    expect(clampBoundsToDisplays(b, [display])).toEqual(b);
  });

  test("画面外 → workArea 中央にフォールバック", () => {
    const b: WindowBounds = { width: 800, height: 600, x: 5000, y: 5000 };
    const result = clampBoundsToDisplays(b, [display]);
    // 中央に配置
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(1920);
    expect(result.y + result.height).toBeLessThanOrEqual(1080);
  });

  test("displays が空 → DEFAULT_BOUNDS", () => {
    const b: WindowBounds = { width: 800, height: 600, x: 100, y: 100 };
    expect(clampBoundsToDisplays(b, [])).toEqual(DEFAULT_BOUNDS);
  });

  test("幅がディスプレイ超過 → workArea に収まるようクリップ", () => {
    const b: WindowBounds = { width: 9999, height: 9999, x: 8000, y: 8000 };
    const result = clampBoundsToDisplays(b, [display]);
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1080);
  });

  test("maximized フラグを保持して返す", () => {
    const b: WindowBounds = {
      width: 800,
      height: 600,
      x: 100,
      y: 100,
      maximized: true,
    };
    expect(clampBoundsToDisplays(b, [display]).maximized).toBe(true);
  });
});

describe("resolveStateKey", () => {
  test("null → NO_GIT_ROOT_KEY", () => {
    expect(resolveStateKey(null)).toBe(NO_GIT_ROOT_KEY);
  });

  test("文字列 → そのまま", () => {
    expect(resolveStateKey("/foo/bar")).toBe("/foo/bar");
  });
});

describe("createWindowStateSaver", () => {
  test("schedule を連続呼び出しても保存は最新値 1 回だけ", async () => {
    const saver = createWindowStateSaver({
      key: "/repo/a",
      filePath: stateFile,
      delayMs: 30,
    });
    saver.schedule({ width: 800, height: 600, x: 0, y: 0 });
    saver.schedule({ width: 900, height: 700, x: 10, y: 20 });
    saver.schedule({ width: 1000, height: 800, x: 20, y: 30 });

    await new Promise((r) => setTimeout(r, 80));
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"]).toEqual({ width: 1000, height: 800, x: 20, y: 30 });
    saver.dispose();
  });

  test("flush で即保存される（タイマー到達前）", () => {
    const saver = createWindowStateSaver({
      key: "/repo/a",
      filePath: stateFile,
      delayMs: 10000,
    });
    saver.schedule({ width: 800, height: 600, x: 5, y: 6 });
    saver.flush();
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"]).toEqual({ width: 800, height: 600, x: 5, y: 6 });
    saver.dispose();
  });

  test("flush 後にタイマーが発火しても二重保存しない（値変化なし）", async () => {
    const saver = createWindowStateSaver({
      key: "/repo/a",
      filePath: stateFile,
      delayMs: 20,
    });
    saver.schedule({ width: 800, height: 600, x: 5, y: 6 });
    saver.flush();
    await new Promise((r) => setTimeout(r, 50));
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw["/repo/a"]).toEqual({ width: 800, height: 600, x: 5, y: 6 });
    saver.dispose();
  });

  test("dispose 後は schedule しても保存されない", async () => {
    const saver = createWindowStateSaver({
      key: "/repo/a",
      filePath: stateFile,
      delayMs: 20,
    });
    saver.dispose();
    saver.schedule({ width: 800, height: 600, x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(stateFile)).toBe(false);
  });

  test("pending なしで flush しても no-op", () => {
    const saver = createWindowStateSaver({
      key: "/repo/a",
      filePath: stateFile,
      delayMs: 100,
    });
    saver.flush();
    expect(existsSync(stateFile)).toBe(false);
    saver.dispose();
  });
});
