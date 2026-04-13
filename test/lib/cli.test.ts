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
});
