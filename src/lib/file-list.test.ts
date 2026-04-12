/**
 * file-list.ts のユニットテスト
 */

import { describe, expect, test } from "bun:test";
import {
  activeEntry,
  addFile,
  createEmptyState,
  removeByPath,
  setActiveByPath,
  toRelative,
} from "./file-list";

describe("createEmptyState", () => {
  test("空 state を返す", () => {
    const s = createEmptyState();
    expect(s.files).toEqual([]);
    expect(s.activeIndex).toBe(-1);
  });
});

describe("addFile", () => {
  test("空状態に 1 件追加すると activeIndex=0 になる", () => {
    const s = addFile(createEmptyState(), {
      absolutePath: "/a/b/c.md",
      relativePath: "b/c.md",
    });
    expect(s.files.length).toBe(1);
    expect(s.activeIndex).toBe(0);
    expect(s.files[0]?.absolutePath).toBe("/a/b/c.md");
  });

  test("複数件追加すると最後がアクティブになる", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    s = addFile(s, { absolutePath: "/a/z.md", relativePath: "z.md" });
    expect(s.files.length).toBe(3);
    expect(s.activeIndex).toBe(2);
  });

  test("同一パスを追加すると重複せず、既存 index がアクティブになる", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    // 1件目を再度追加
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    expect(s.files.length).toBe(2);
    expect(s.activeIndex).toBe(0);
  });

  test("正規化された同一パス（../ 等）も重複として扱う", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/b/c.md", relativePath: "b/c.md" });
    s = addFile(s, {
      absolutePath: "/a/b/../b/c.md",
      relativePath: "b/c.md",
    });
    expect(s.files.length).toBe(1);
    expect(s.activeIndex).toBe(0);
  });
});

describe("removeByPath", () => {
  test("非アクティブ削除で activeIndex が変わらない (削除 index > activeIndex)", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    s = addFile(s, { absolutePath: "/a/z.md", relativePath: "z.md" });
    // active = 2 (z.md)。y.md (index=1) を削除
    s = setActiveByPath(s, "/a/z.md");
    expect(s.activeIndex).toBe(2);
    s = removeByPath(s, "/a/y.md");
    expect(s.files.length).toBe(2);
    // z.md は index=1 にずれる
    expect(s.activeIndex).toBe(1);
    expect(s.files[s.activeIndex]?.absolutePath).toBe("/a/z.md");
  });

  test("非アクティブ削除 (削除 index < activeIndex) で activeIndex が -1 される", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    // active = 1 (y.md)。x.md (index=0) を削除
    s = removeByPath(s, "/a/x.md");
    expect(s.files.length).toBe(1);
    expect(s.activeIndex).toBe(0);
    expect(s.files[0]?.absolutePath).toBe("/a/y.md");
  });

  test("アクティブ削除で次（同 index）がアクティブ化される", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    s = addFile(s, { absolutePath: "/a/z.md", relativePath: "z.md" });
    // active = 1 (y.md) を削除 → 同 index 1 = z.md
    s = setActiveByPath(s, "/a/y.md");
    s = removeByPath(s, "/a/y.md");
    expect(s.files.length).toBe(2);
    expect(s.activeIndex).toBe(1);
    expect(s.files[1]?.absolutePath).toBe("/a/z.md");
  });

  test("末尾アクティブ削除では前 (index-1) がアクティブ化される", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    // active = 1 (y.md, 末尾) を削除 → index-1 = 0 (x.md)
    s = removeByPath(s, "/a/y.md");
    expect(s.files.length).toBe(1);
    expect(s.activeIndex).toBe(0);
    expect(s.files[0]?.absolutePath).toBe("/a/x.md");
  });

  test("最後の 1 件を削除すると activeIndex=-1 になる", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = removeByPath(s, "/a/x.md");
    expect(s.files.length).toBe(0);
    expect(s.activeIndex).toBe(-1);
  });

  test("該当しないパスを削除しても state は変わらない", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    const after = removeByPath(s, "/a/none.md");
    expect(after).toEqual(s);
  });
});

describe("setActiveByPath", () => {
  test("存在するパスでアクティブが切り替わる", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    s = setActiveByPath(s, "/a/x.md");
    expect(s.activeIndex).toBe(0);
  });

  test("存在しないパスは無視される", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    const after = setActiveByPath(s, "/a/none.md");
    expect(after).toEqual(s);
  });
});

describe("activeEntry", () => {
  test("空 state は null を返す", () => {
    expect(activeEntry(createEmptyState())).toBeNull();
  });

  test("アクティブな entry を返す", () => {
    let s = createEmptyState();
    s = addFile(s, { absolutePath: "/a/x.md", relativePath: "x.md" });
    s = addFile(s, { absolutePath: "/a/y.md", relativePath: "y.md" });
    expect(activeEntry(s)?.absolutePath).toBe("/a/y.md");
  });
});

describe("toRelative", () => {
  test("gitRoot 配下のファイルは相対パスを返す", () => {
    expect(toRelative("/repo/docs/seed.md", "/repo")).toBe("docs/seed.md");
  });

  test("gitRoot 外のファイルは basename にフォールバック", () => {
    expect(toRelative("/other/place/x.md", "/repo")).toBe("x.md");
  });

  test("gitRoot 自体に同じパスを渡すと basename を返す", () => {
    expect(toRelative("/repo", "/repo")).toBe("repo");
  });
});
