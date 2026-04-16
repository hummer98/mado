/**
 * listMarkdownFiles のテスト
 *
 * 一時ディレクトリを作成して実ファイルシステム上で動作を検証する。
 * plan.md §5 ステップ 1 の 12 ケース (テーブル) をカバーする。
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { listMarkdownFiles } from "../../src/lib/markdown-discovery";

describe("listMarkdownFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "mado-disc-"));
  });

  afterEach(() => {
    // chmod を戻してから削除（権限エラーケース対策）
    try {
      chmodSync(dir, 0o700);
    } catch {
      // ignore
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("recursive=false: 直下の .md のみ列挙する", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "b.md"), "b");
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "c.md"), "c");

    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toEqual([
      path.join(dir, "a.md"),
      path.join(dir, "b.md"),
    ]);
    expect(result.errors).toHaveLength(0);
  });

  test("recursive=true: サブディレクトリ配下も列挙する", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "b.md"), "b");
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "c.md"), "c");

    const result = listMarkdownFiles(dir, { recursive: true });
    expect(result.files).toEqual([
      path.join(dir, "a.md"),
      path.join(dir, "b.md"),
      path.join(dir, "sub", "c.md"),
    ]);
    expect(result.errors).toHaveLength(0);
  });

  test(".git ディレクトリには降下しない", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    mkdirSync(path.join(dir, ".git"));
    writeFileSync(path.join(dir, ".git", "config.md"), "c");

    const result = listMarkdownFiles(dir, { recursive: true });
    expect(result.files).toEqual([path.join(dir, "a.md")]);
    expect(result.excludedDirs).toContain(".git");
  });

  test("ドット始まりディレクトリ (.github) は除外する", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    mkdirSync(path.join(dir, ".github"));
    writeFileSync(path.join(dir, ".github", "pr.md"), "p");

    const result = listMarkdownFiles(dir, { recursive: true });
    expect(result.files).toEqual([path.join(dir, "a.md")]);
    expect(result.excludedDirs).toContain(".github");
  });

  test("node_modules ディレクトリは除外する", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    mkdirSync(path.join(dir, "node_modules"));
    mkdirSync(path.join(dir, "node_modules", "pkg"));
    writeFileSync(path.join(dir, "node_modules", "pkg", "README.md"), "r");

    const result = listMarkdownFiles(dir, { recursive: true });
    expect(result.files).toEqual([path.join(dir, "a.md")]);
    expect(result.excludedDirs).toContain("node_modules");
  });

  test(".markdown 拡張子も含める", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "b.markdown"), "b");

    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toEqual([
      path.join(dir, "a.md"),
      path.join(dir, "b.markdown"),
    ]);
  });

  test(".mdx や .txt などは除外する", () => {
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "b.txt"), "b");
    writeFileSync(path.join(dir, "c.mdx"), "c");

    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toEqual([path.join(dir, "a.md")]);
  });

  test("ディレクトリを指す symlink には降下しない", () => {
    mkdirSync(path.join(dir, "real"));
    writeFileSync(path.join(dir, "real", "a.md"), "a");
    symlinkSync(path.join(dir, "real"), path.join(dir, "link"), "dir");

    const result = listMarkdownFiles(dir, { recursive: true });
    expect(result.files).toEqual([path.join(dir, "real", "a.md")]);
  });

  test("ファイルを指す symlink (.md) は含める", () => {
    writeFileSync(path.join(dir, "target.md"), "t");
    symlinkSync(path.join(dir, "target.md"), path.join(dir, "link.md"), "file");

    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toContain(path.join(dir, "link.md"));
    expect(result.files).toContain(path.join(dir, "target.md"));
  });

  test("ソート順がコードポイント順 (大文字小文字区別)", () => {
    writeFileSync(path.join(dir, "Z.md"), "z");
    writeFileSync(path.join(dir, "a.md"), "a");
    writeFileSync(path.join(dir, "B.md"), "b");

    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toEqual([
      path.join(dir, "B.md"),
      path.join(dir, "Z.md"),
      path.join(dir, "a.md"),
    ]);
  });

  test("空ディレクトリは 0 件を返す", () => {
    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("非 ASCII / 日本語ファイル名も列挙される", () => {
    writeFileSync(path.join(dir, "日本語.md"), "ja");
    const result = listMarkdownFiles(dir, { recursive: false });
    expect(result.files).toEqual([path.join(dir, "日本語.md")]);
  });

  test("権限エラー sub: errors に記録し、残りのファイルは列挙される", () => {
    // root 権限では chmod が効かないため skip 判定
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot) return;

    writeFileSync(path.join(dir, "a.md"), "a");
    mkdirSync(path.join(dir, "sub"));
    writeFileSync(path.join(dir, "sub", "b.md"), "b");
    chmodSync(path.join(dir, "sub"), 0o000);

    const result = listMarkdownFiles(dir, { recursive: true });
    // 権限復旧（afterEach の削除のため）
    chmodSync(path.join(dir, "sub"), 0o700);

    expect(result.files).toContain(path.join(dir, "a.md"));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].path).toContain("sub");
  });
});
