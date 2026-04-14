/**
 * CLI 引数バリデーションのテスト
 */

import { describe, test, expect } from "bun:test";
import { parseCliArgs } from "../../src/lib/cli";
import type { CliArgsFileOk, CliArgsWelcome, CliArgsError } from "../../src/lib/cli";
import * as path from "node:path";

describe("parseCliArgs", () => {
  test("存在する .md ファイルを受け付ける", () => {
    // README.md は worktree のルートに存在する
    const result = parseCliArgs(["node", "mado", "README.md"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("file");
    const ok = result as CliArgsFileOk;
    expect(ok.filePath).toBe(path.resolve("README.md"));
    expect(ok.source).toBe("argv");
    expect(ok.warnings).toHaveLength(0);
  });

  test("存在しないファイルはエラーを返す", () => {
    const result = parseCliArgs(["node", "mado", "nonexistent-file.md"]);
    expect(result.ok).toBe(false);
    const err = result as CliArgsError;
    expect(err.error).toContain("ファイルが見つかりません");
  });

  test("argv も env も無ければ welcome mode を返す", () => {
    // T025 退行防止: 旧ビルドに残存していた `rawPath = "README.md"` フォールバック
    // (launcher の cwd=Contents/MacOS/ で path.resolve して「ファイルが見つかりません」
    // になる問題) が復活しないことを固定化する。
    const result = parseCliArgs(["node", "mado"], {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("welcome");
    const welcome = result as CliArgsWelcome;
    expect(welcome.mode).toBe("welcome");
  });

  test("Markdown 以外の拡張子は警告つきで受け付ける", () => {
    // package.json は存在するが .md ではない
    const result = parseCliArgs(["node", "mado", "package.json"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("file");
    const ok = result as CliArgsFileOk;
    expect(ok.warnings.length).toBeGreaterThan(0);
    expect(ok.warnings[0]).toContain("Markdown ファイルではない可能性があります");
  });

  test("絶対パスも受け付ける", () => {
    const absPath = path.resolve("README.md");
    const result = parseCliArgs(["node", "mado", absPath]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ok = result as CliArgsFileOk;
    expect(ok.filePath).toBe(absPath);
  });

  test("argv が無ければ MADO_FILE 環境変数を読む", () => {
    const env = { MADO_FILE: path.resolve("docs/seed.md") };
    const result = parseCliArgs(["node", "mado"], env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("file");
    const ok = result as CliArgsFileOk;
    expect(ok.filePath).toBe(path.resolve("docs/seed.md"));
    expect(ok.source).toBe("env");
  });

  test("argv が指定された場合は MADO_FILE より argv を優先する", () => {
    const env = { MADO_FILE: path.resolve("docs/seed.md") };
    const result = parseCliArgs(["node", "mado", "README.md"], env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ok = result as CliArgsFileOk;
    expect(ok.filePath).toBe(path.resolve("README.md"));
    expect(ok.source).toBe("argv");
  });

  test("env.MADO_FILE が指定されたが不在ならエラーを返す", () => {
    const env = { MADO_FILE: path.resolve("nonexistent-from-env.md") };
    const result = parseCliArgs(["node", "mado"], env);
    expect(result.ok).toBe(false);
    const err = result as CliArgsError;
    expect(err.error).toContain("ファイルが見つかりません");
  });

  test("argv なし + env に相対パスの .md → file, env, cwd 基準で resolve される", () => {
    // T025: launcher が argv を forwarding しない環境で、bin/mado ラッパが相対パスを
    // そのまま MADO_FILE に入れて渡してきた場合でも正しく開けること。
    const env = { MADO_FILE: "docs/seed.md" };
    const result = parseCliArgs(["node", "mado"], env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("file");
    const ok = result as CliArgsFileOk;
    expect(ok.source).toBe("env");
    expect(ok.filePath).toBe(path.resolve("docs/seed.md"));
  });

  test("argv なし + env に絶対パスの .md → file, env, そのパス", () => {
    // T025: bin/mado ラッパが絶対パス化した MADO_FILE を渡してくる通常系。
    const absPath = path.resolve("docs/seed.md");
    const env = { MADO_FILE: absPath };
    const result = parseCliArgs(["node", "mado"], env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("file");
    const ok = result as CliArgsFileOk;
    expect(ok.source).toBe("env");
    expect(ok.filePath).toBe(absPath);
  });

  test("env.MADO_FILE が空文字列なら welcome mode を返す", () => {
    // cli.ts の `env.MADO_FILE.length > 0` 条件を固定化する。
    const result = parseCliArgs(["node", "mado"], { MADO_FILE: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("welcome");
  });
});
