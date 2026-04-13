/**
 * window-title.ts のユニットテスト
 */

import { describe, expect, test } from "bun:test";
import { buildWindowTitle } from "./window-title";

describe("buildWindowTitle", () => {
  test("アクティブファイルなし、gitRoot なし → 'mado'", () => {
    expect(buildWindowTitle({ activePath: null, gitRoot: null })).toBe("mado");
  });

  test("アクティブファイルなし、gitRoot あり → 'mado'", () => {
    expect(buildWindowTitle({ activePath: null, gitRoot: "/repo" })).toBe(
      "mado",
    );
  });

  test("git root 配下の浅いパス", () => {
    expect(
      buildWindowTitle({
        activePath: "/repo/README.md",
        gitRoot: "/repo",
      }),
    ).toBe("mado - repo - README.md");
  });

  test("git root 配下の深いパス", () => {
    expect(
      buildWindowTitle({
        activePath: "/repo/docs/seed.md",
        gitRoot: "/repo",
      }),
    ).toBe("mado - repo - docs/seed.md");
  });

  test("プロジェクト名にスペースや日本語を含む場合", () => {
    expect(
      buildWindowTitle({
        activePath: "/path/to/My Project/a.md",
        gitRoot: "/path/to/My Project",
      }),
    ).toBe("mado - My Project - a.md");
  });

  test("git root 未検出のファイル", () => {
    expect(
      buildWindowTitle({
        activePath: "/tmp/note.md",
        gitRoot: null,
      }),
    ).toBe("mado - note.md");
  });

  test("gitRoot は検出済みだがファイルは gitRoot 外 → basename フォールバック", () => {
    expect(
      buildWindowTitle({
        activePath: "/tmp/x.md",
        gitRoot: "/repo",
      }),
    ).toBe("mado - repo - x.md");
  });

  test("gitRoot の末尾スラッシュは正規化される", () => {
    const withSlash = buildWindowTitle({
      activePath: "/repo/README.md",
      gitRoot: "/repo/",
    });
    const withoutSlash = buildWindowTitle({
      activePath: "/repo/README.md",
      gitRoot: "/repo",
    });
    expect(withSlash).toBe(withoutSlash);
    expect(withSlash).toBe("mado - repo - README.md");
  });

  test("activePath は path.resolve 済みである前提だが、絶対パスで渡された場合に正常動作する", () => {
    // 相対パス入力は呼び出し側で path.resolve 済みとする前提。
    // 絶対パスで渡す限り basename ロジックは安定。
    expect(
      buildWindowTitle({
        activePath: "/a/b/c/d.md",
        gitRoot: null,
      }),
    ).toBe("mado - d.md");
  });
});
