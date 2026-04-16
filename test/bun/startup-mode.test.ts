/**
 * decideStartupMode: parseCliArgs の結果から main() の起動モードを決める純関数のテスト
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decideStartupMode } from "../../src/bun/startup";
import { parseCliArgs } from "../../src/lib/cli";

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

  test("directory パース結果 → directory kind (dirPath/recursive を保持)", () => {
    const mode = decideStartupMode({
      ok: true,
      mode: "directory",
      dirPath: "/abs/docs",
      recursive: true,
      source: "argv",
      warnings: [],
    });
    expect(mode.kind).toBe("directory");
    if (mode.kind === "directory") {
      expect(mode.dirPath).toBe("/abs/docs");
      expect(mode.recursive).toBe(true);
    }
  });
});

describe("parseCliArgs + decideStartupMode の組合せ", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "mado-startup-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("tmpdir 上の .md 配置 → parseCliArgs → decideStartupMode で directory kind", () => {
    writeFileSync(path.join(tmpDir, "a.md"), "a");
    const parsed = parseCliArgs(["node", "mado", tmpDir]);
    const mode = decideStartupMode(parsed);
    expect(mode.kind).toBe("directory");
    if (mode.kind === "directory") {
      expect(mode.dirPath).toBe(path.resolve(tmpDir));
      expect(mode.recursive).toBe(false);
    }
  });

  test("tmpdir + -r → directory kind, recursive=true", () => {
    writeFileSync(path.join(tmpDir, "a.md"), "a");
    const parsed = parseCliArgs(["node", "mado", "-r", tmpDir]);
    const mode = decideStartupMode(parsed);
    expect(mode.kind).toBe("directory");
    if (mode.kind === "directory") {
      expect(mode.recursive).toBe(true);
    }
  });
});
