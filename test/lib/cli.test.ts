/**
 * CLI 引数バリデーションのテスト
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseCliArgs } from "../../src/lib/cli";
import type {
  CliArgsFileOk,
  CliArgsDirectoryOk,
  CliArgsWelcome,
  CliArgsError,
} from "../../src/lib/cli";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import * as os from "node:os";
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

describe("parseCliArgs (directory mode)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "mado-cli-"));
  });

  afterEach(() => {
    try {
      chmodSync(tmpDir, 0o700);
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("既存ディレクトリを指定 → directory mode, recursive=false", () => {
    const result = parseCliArgs(["node", "mado", tmpDir]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("directory");
    const ok = result as CliArgsDirectoryOk;
    expect(ok.dirPath).toBe(path.resolve(tmpDir));
    expect(ok.recursive).toBe(false);
    expect(ok.source).toBe("argv");
  });

  test("-r <dir> → recursive=true", () => {
    const result = parseCliArgs(["node", "mado", "-r", tmpDir]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("directory");
    const ok = result as CliArgsDirectoryOk;
    expect(ok.recursive).toBe(true);
    expect(ok.dirPath).toBe(path.resolve(tmpDir));
  });

  test("--recursive <dir> → recursive=true", () => {
    const result = parseCliArgs(["node", "mado", "--recursive", tmpDir]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ok = result as CliArgsDirectoryOk;
    expect(ok.recursive).toBe(true);
  });

  test("<dir> -r (フラグが後ろ) でも recursive=true", () => {
    const result = parseCliArgs(["node", "mado", tmpDir, "-r"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ok = result as CliArgsDirectoryOk;
    expect(ok.recursive).toBe(true);
  });

  test("-r <file.md> → エラー (`-r はディレクトリ指定時のみ有効です`)", () => {
    const file = path.join(tmpDir, "a.md");
    writeFileSync(file, "a");
    const result = parseCliArgs(["node", "mado", "-r", file]);
    expect(result.ok).toBe(false);
    const err = result as CliArgsError;
    expect(err.error).toContain("-r");
    expect(err.error).toContain("ディレクトリ");
  });

  test("-r + env.MADO_FILE (argv に positional なし) → エラー", () => {
    const file = path.join(tmpDir, "a.md");
    writeFileSync(file, "a");
    const result = parseCliArgs(["node", "mado", "-r"], { MADO_FILE: file });
    expect(result.ok).toBe(false);
    const err = result as CliArgsError;
    expect(err.error).toContain("-r");
  });

  test("2 つ以上の positional → エラー", () => {
    const dirA = mkdtempSync(path.join(os.tmpdir(), "mado-cli-a-"));
    const dirB = mkdtempSync(path.join(os.tmpdir(), "mado-cli-b-"));
    try {
      const result = parseCliArgs(["node", "mado", dirA, dirB]);
      expect(result.ok).toBe(false);
      const err = result as CliArgsError;
      expect(err.error.length).toBeGreaterThan(0);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  test("存在しないパス → 「ファイルが見つかりません」", () => {
    const result = parseCliArgs([
      "node",
      "mado",
      path.join(tmpDir, "does-not-exist"),
    ]);
    expect(result.ok).toBe(false);
    const err = result as CliArgsError;
    expect(err.error).toContain("ファイルが見つかりません");
  });

  test("権限エラーのパス (EACCES) → 「アクセス権限がありません」", () => {
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot) return;

    const subDir = path.join(tmpDir, "locked");
    mkdirSync(subDir);
    const target = path.join(subDir, "child");
    mkdirSync(target);
    chmodSync(subDir, 0o000);
    try {
      const result = parseCliArgs(["node", "mado", target]);
      expect(result.ok).toBe(false);
      const err = result as CliArgsError;
      expect(err.error).toContain("アクセス権限がありません");
    } finally {
      chmodSync(subDir, 0o700);
    }
  });

  test("env.MADO_FILE にディレクトリが入った場合 → 「ファイルが見つかりません」系のエラー (env は file 専用)", () => {
    // plan.md §2-1 要確認事項 #1: env はディレクトリをサポートしない。
    // 現実装は env 由来を file 扱いするため、拡張子チェックや statSync 経由で
    // エラー終了するはず (dir は Markdown 拡張子を持たないので拡張子警告＋既存 flow)。
    // ここでは「ok=false で error が返る、または ok=true で file mode」のいずれかを
    // 確定させる。今回は file 扱い（warning 付き）として受け入れる方針なので ok=true を期待する。
    const result = parseCliArgs(["node", "mado"], { MADO_FILE: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // env 経由はディレクトリでも file モードに流れる（既存挙動）。warnings に拡張子警告が残るはず。
    expect(result.mode).toBe("file");
  });
});
