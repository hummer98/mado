/**
 * Mermaid エラーフォーマット関数のテスト
 */

import { describe, test, expect } from "bun:test";
import {
  formatMermaidError,
  formatMermaidErrorBox,
  type MermaidErrorInfo,
} from "../../src/lib/mermaid-error";

describe("formatMermaidError", () => {
  test("index=0 のエラーを #1 として表示する", () => {
    const error: MermaidErrorInfo = {
      index: 0,
      message: "Parse error on line 3",
      code: "graph TD\n  A --> B --> C",
    };
    expect(formatMermaidError(error)).toBe(
      "[mado] Mermaid error in diagram #1: Parse error on line 3"
    );
  });

  test("index=2 のエラーを #3 として表示する", () => {
    const error: MermaidErrorInfo = {
      index: 2,
      message: "Unknown diagram type",
      code: "invalid\n  syntax",
    };
    expect(formatMermaidError(error)).toBe(
      "[mado] Mermaid error in diagram #3: Unknown diagram type"
    );
  });

  test("空のメッセージを処理できる", () => {
    const error: MermaidErrorInfo = {
      index: 0,
      message: "",
      code: "",
    };
    expect(formatMermaidError(error)).toBe(
      "[mado] Mermaid error in diagram #1: "
    );
  });
});

describe("formatMermaidErrorBox", () => {
  test("罫線ボックスでエラーを囲む", () => {
    const error: MermaidErrorInfo = {
      index: 0,
      message: "Parse error on line 3",
      code: "graph TD\n  A --> B",
    };
    const result = formatMermaidErrorBox(error);
    expect(result).toContain("┌─");
    expect(result).toContain("└─");
    expect(result).toContain("│");
    expect(result).toContain("Mermaid Error");
    expect(result).toContain("Parse error on line 3");
  });

  test("コードのプレビューを先頭3行に制限する", () => {
    const error: MermaidErrorInfo = {
      index: 0,
      message: "Syntax error",
      code: "line1\nline2\nline3\nline4\nline5",
    };
    const result = formatMermaidErrorBox(error);
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).not.toContain("line4");
  });

  test("コードが空の場合はコードプレビューを省略する", () => {
    const error: MermaidErrorInfo = {
      index: 1,
      message: "Unknown error",
      code: "",
    };
    const result = formatMermaidErrorBox(error);
    expect(result).toContain("Unknown error");
    expect(result).not.toContain("Source:");
  });

  test("長いメッセージに合わせてボックスが拡張される", () => {
    const longMsg = "A".repeat(60);
    const error: MermaidErrorInfo = {
      index: 0,
      message: longMsg,
      code: "short",
    };
    const result = formatMermaidErrorBox(error);
    const lines = result.split("\n");
    // 全行が同じ幅であること
    const topLen = lines[0].length;
    const bottomLen = lines[lines.length - 1].length;
    expect(topLen).toBe(bottomLen);
  });
});
