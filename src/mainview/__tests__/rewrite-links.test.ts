/**
 * リンク分類ロジックのユニットテスト
 */

import { describe, expect, test } from "bun:test";
import { classifyLink } from "../rewrite-links";

const filePath = "/home/user/project/docs/README.md";

describe("classifyLink", () => {
  test("# で始まる href はアンカー扱い", () => {
    const r = classifyLink("#section", filePath);
    expect(r).toEqual({ kind: "anchor" });
  });

  test("https:// は外部 URL 扱い", () => {
    const r = classifyLink("https://example.com/x", filePath);
    expect(r).toEqual({ kind: "external", url: "https://example.com/x" });
  });

  test("http:// は外部 URL 扱い", () => {
    const r = classifyLink("http://example.com", filePath);
    expect(r).toEqual({ kind: "external", url: "http://example.com" });
  });

  test("mailto: は外部 URL 扱い", () => {
    const r = classifyLink("mailto:foo@example.com", filePath);
    expect(r).toEqual({ kind: "external", url: "mailto:foo@example.com" });
  });

  test("views:// は無視 (WebView 内部 URL)", () => {
    expect(classifyLink("views://mainview/x", filePath)).toBeNull();
  });

  test("file:// は無視", () => {
    expect(classifyLink("file:///etc/passwd", filePath)).toBeNull();
  });

  test("空文字は無視", () => {
    expect(classifyLink("", filePath)).toBeNull();
  });

  test("相対 .md は open-file として絶対パスに解決される", () => {
    const r = classifyLink("./other.md", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/home/user/project/docs/other.md",
      fragment: null,
    });
  });

  test("../ を含む相対パスを解決する", () => {
    const r = classifyLink("../sibling.md", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/home/user/project/sibling.md",
      fragment: null,
    });
  });

  test("ファイル名だけの相対パスを解決する", () => {
    const r = classifyLink("notes.md", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/home/user/project/docs/notes.md",
      fragment: null,
    });
  });

  test("絶対パスもそのまま open-file 扱い", () => {
    const r = classifyLink("/abs/path.md", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/abs/path.md",
      fragment: null,
    });
  });

  test("fragment 付き相対 .md は fragment を分離する", () => {
    const r = classifyLink("./other.md#heading", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/home/user/project/docs/other.md",
      fragment: "heading",
    });
  });

  test("URL エンコードされたパスはデコードされる", () => {
    const r = classifyLink("./with%20space.md", filePath);
    expect(r).toEqual({
      kind: "open-file",
      absolutePath: "/home/user/project/docs/with space.md",
      fragment: null,
    });
  });
});
