/**
 * find.ts の純粋ロジック検証 (T043)。
 *
 * findRanges は DOM Range を直接作らず {nodeIndex, start, end} のレコード配列を
 * 返す純粋関数なので、bun:test で DOM 不要に検証できる。
 * DOM 連携部分 (collectTextNodes / applyHighlights / scrollToCurrent) は
 * 手動検証でカバーする。
 */

import { describe, expect, test } from "bun:test";
import { findRanges } from "../find";

describe("findRanges", () => {
  test("空クエリは空配列を返す", () => {
    const r = findRanges([{ value: "Hello" }], "", {
      caseInsensitive: true,
      max: 100,
    });
    expect(r).toEqual([]);
  });

  test("単一ノード内で複数マッチを返す", () => {
    const r = findRanges([{ value: "ababab" }], "ab", {
      caseInsensitive: true,
      max: 100,
    });
    expect(r).toEqual([
      { nodeIndex: 0, start: 0, end: 2 },
      { nodeIndex: 0, start: 2, end: 4 },
      { nodeIndex: 0, start: 4, end: 6 },
    ]);
  });

  test("case-insensitive で Mixed Case にマッチする", () => {
    const r = findRanges([{ value: "Hello WORLD" }], "world", {
      caseInsensitive: true,
      max: 100,
    });
    expect(r).toEqual([{ nodeIndex: 0, start: 6, end: 11 }]);
  });

  test("複数ノードに渡って検索する", () => {
    const r = findRanges(
      [{ value: "foo bar" }, { value: "bar baz" }],
      "bar",
      { caseInsensitive: true, max: 100 },
    );
    expect(r).toEqual([
      { nodeIndex: 0, start: 4, end: 7 },
      { nodeIndex: 1, start: 0, end: 3 },
    ]);
  });

  test("max を超えると打ち切る", () => {
    const r = findRanges([{ value: "aaaaaaaaaa" }], "a", {
      caseInsensitive: true,
      max: 3,
    });
    expect(r).toHaveLength(3);
  });

  test("ノードを跨ぐマッチは検出しない（仕様）", () => {
    const r = findRanges(
      [{ value: "foo" }, { value: "bar" }],
      "foobar",
      { caseInsensitive: true, max: 100 },
    );
    expect(r).toEqual([]);
  });
});
