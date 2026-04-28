/**
 * preferences.ts のユニットテスト
 *
 * 一時ファイルは `tmpdir()` 配下の使い捨てディレクトリに作る。
 * recent-files.test.ts と同じパターン。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "./preferences";

let tmpDir: string;
let storeFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mado-preferences-"));
  storeFile = path.join(tmpDir, "preferences.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadPreferences", () => {
  test("ファイル不在 → DEFAULT_PREFERENCES を返す", () => {
    expect(loadPreferences(storeFile)).toEqual(DEFAULT_PREFERENCES);
  });

  test("正常 JSON → 値が反映される", () => {
    writeFileSync(
      storeFile,
      JSON.stringify({ version: 1, wideLayout: true }),
    );
    const result = loadPreferences(storeFile);
    expect(result.wideLayout).toBe(true);
  });

  test("不正 JSON → DEFAULT_PREFERENCES + corrupt 退避ファイル生成", () => {
    writeFileSync(storeFile, "{ not valid json");
    expect(loadPreferences(storeFile)).toEqual(DEFAULT_PREFERENCES);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBe(1);
  });

  test("version 不一致 → DEFAULT_PREFERENCES + corrupt 退避", () => {
    writeFileSync(
      storeFile,
      JSON.stringify({ version: 2, wideLayout: true }),
    );
    expect(loadPreferences(storeFile)).toEqual(DEFAULT_PREFERENCES);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBe(1);
  });

  test("schema 不一致（型違い）→ DEFAULT_PREFERENCES + corrupt 退避", () => {
    writeFileSync(
      storeFile,
      JSON.stringify({ version: 1, wideLayout: "yes" }),
    );
    expect(loadPreferences(storeFile)).toEqual(DEFAULT_PREFERENCES);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBe(1);
  });
});

describe("savePreferences", () => {
  test("書いた値を loadPreferences で読める（roundtrip）", () => {
    savePreferences({ wideLayout: true }, storeFile);
    expect(loadPreferences(storeFile).wideLayout).toBe(true);
  });

  test("false で上書きできる", () => {
    savePreferences({ wideLayout: true }, storeFile);
    savePreferences({ wideLayout: false }, storeFile);
    expect(loadPreferences(storeFile).wideLayout).toBe(false);
  });

  test("atomic write: 一時ファイル (.tmp-*) が残らない", () => {
    savePreferences({ wideLayout: true }, storeFile);
    const remnants = readdirSync(tmpDir).filter((f) =>
      f.includes(".tmp-"),
    );
    expect(remnants).toEqual([]);
  });

  test("永続化されたファイルは version: 1 を持つ", () => {
    savePreferences({ wideLayout: true }, storeFile);
    const raw = JSON.parse(readFileSync(storeFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.wideLayout).toBe(true);
  });
});

describe("DEFAULT_PREFERENCES", () => {
  test("wideLayout は false（OFF が既定）", () => {
    expect(DEFAULT_PREFERENCES.wideLayout).toBe(false);
  });
});
