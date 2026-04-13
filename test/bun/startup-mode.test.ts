/**
 * decideStartupMode: parseCliArgs の結果から main() の起動モードを決める純関数のテスト
 */

import { describe, test, expect } from "bun:test";
import { decideStartupMode } from "../../src/bun/startup";

describe("decideStartupMode", () => {
  test("welcome パース結果 → welcome kind", () => {
    const mode = decideStartupMode({ ok: true, mode: "welcome" });
    expect(mode.kind).toBe("welcome");
  });

  test("file パース結果 → file kind (filePath を保持)", () => {
    const mode = decideStartupMode({
      ok: true,
      mode: "file",
      filePath: "/abs/README.md",
      source: "argv",
      warnings: [],
    });
    expect(mode.kind).toBe("file");
    if (mode.kind === "file") {
      expect(mode.filePath).toBe("/abs/README.md");
    }
  });

  test("エラー → error kind (message を保持)", () => {
    const mode = decideStartupMode({ ok: false, error: "ファイルが見つかりません: /x" });
    expect(mode.kind).toBe("error");
    if (mode.kind === "error") {
      expect(mode.message).toContain("ファイルが見つかりません");
    }
  });
});
