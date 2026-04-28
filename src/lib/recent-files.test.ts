/**
 * recent-files.ts のユニットテスト
 *
 * 一時ファイルは `tmpdir()` 配下の使い捨てディレクトリに作る。
 * window-state.test.ts と同じパターン。
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
  MAX_RECENT_FILES,
  addRecentFile,
  clearRecentFiles,
  loadRecentFiles,
  removeRecentFile,
} from "./recent-files";

let tmpDir: string;
let storeFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mado-recent-files-"));
  storeFile = path.join(tmpDir, "recent-files.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadRecentFiles", () => {
  test("ファイル不在 → 空配列", () => {
    expect(loadRecentFiles(storeFile)).toEqual([]);
  });

  test("正常 JSON → string[] を返す", () => {
    const a = path.join(tmpDir, "a.md");
    const b = path.join(tmpDir, "b.md");
    writeFileSync(a, "");
    writeFileSync(b, "");
    writeFileSync(storeFile, JSON.stringify({ version: 1, files: [a, b] }));
    expect(loadRecentFiles(storeFile)).toEqual([a, b]);
  });

  test("不正 JSON → [] + corrupt 退避ファイル生成", () => {
    writeFileSync(storeFile, "{ not valid json");
    expect(loadRecentFiles(storeFile)).toEqual([]);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBe(1);
  });

  test("version 不一致 → [] + corrupt 退避", () => {
    writeFileSync(storeFile, JSON.stringify({ version: 2, files: [] }));
    expect(loadRecentFiles(storeFile)).toEqual([]);
    const corrupts = readdirSync(tmpDir).filter((f) => f.includes("corrupt"));
    expect(corrupts.length).toBe(1);
  });

  test("履歴中の存在しないパスは除去されて返る + 書き戻る", () => {
    const a = path.join(tmpDir, "a.md");
    writeFileSync(a, "");
    const missing = path.join(tmpDir, "missing.md");
    writeFileSync(
      storeFile,
      JSON.stringify({ version: 1, files: [a, missing] }),
    );
    expect(loadRecentFiles(storeFile)).toEqual([a]);
    const reread = JSON.parse(readFileSync(storeFile, "utf-8"));
    expect(reread.files).toEqual([a]);
  });
});

describe("addRecentFile", () => {
  test("空状態に追加 → 1 件", () => {
    expect(addRecentFile("/a", storeFile)).toEqual(["/a"]);
  });

  test("複数追加で先頭が最新", () => {
    addRecentFile("/a", storeFile);
    expect(addRecentFile("/b", storeFile)).toEqual(["/b", "/a"]);
  });

  test("既存と重複するパスは先頭に持ち上げ（総数は変わらない）", () => {
    addRecentFile("/a", storeFile);
    addRecentFile("/b", storeFile);
    expect(addRecentFile("/a", storeFile)).toEqual(["/a", "/b"]);
  });

  test("上限超過 → 末尾切り捨て (MAX_RECENT_FILES 件まで)", () => {
    const total = MAX_RECENT_FILES + 3;
    for (let i = 0; i < total; i++) {
      addRecentFile(`/path/${i}.md`, storeFile);
    }
    const raw = JSON.parse(readFileSync(storeFile, "utf-8"));
    expect(raw.files.length).toBe(MAX_RECENT_FILES);
    // 最新 = 最後に追加した index
    expect(raw.files[0]).toBe(`/path/${total - 1}.md`);
    // 末尾 = (total - MAX) 番目に追加したもの
    expect(raw.files[MAX_RECENT_FILES - 1]).toBe(
      `/path/${total - MAX_RECENT_FILES}.md`,
    );
  });

  test("相対パスを渡しても絶対パスに正規化されて保存される", () => {
    const result = addRecentFile("./relative.md", storeFile);
    expect(path.isAbsolute(result[0]!)).toBe(true);
  });
});

describe("removeRecentFile", () => {
  test("該当エントリを除去", () => {
    addRecentFile("/a", storeFile);
    addRecentFile("/b", storeFile);
    expect(removeRecentFile("/a", storeFile)).toEqual(["/b"]);
  });

  test("存在しないパスを指定しても落ちない（no-op）", () => {
    addRecentFile("/a", storeFile);
    expect(removeRecentFile("/never-existed", storeFile)).toEqual(["/a"]);
  });
});

describe("clearRecentFiles", () => {
  test("空配列で書き戻る（ファイルは残る）", () => {
    addRecentFile("/a", storeFile);
    clearRecentFiles(storeFile);
    const raw = JSON.parse(readFileSync(storeFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.files).toEqual([]);
  });
});
