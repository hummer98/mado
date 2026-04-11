/**
 * Mermaid エラー情報のフォーマット
 *
 * WebView 側のインライン表示と CLI stdout 出力で共用する。
 */

/** Mermaid ダイアグラムのエラー情報 */
export interface MermaidErrorInfo {
  /** ダイアグラムの出現順序（0 始まり） */
  index: number;
  /** エラーメッセージ */
  message: string;
  /** 元の Mermaid コード */
  code: string;
}

/**
 * CLI stdout 向けの1行エラーメッセージを生成する。
 *
 * @example
 * formatMermaidError({ index: 0, message: "Parse error", code: "..." })
 * // → "[mado] Mermaid error in diagram #1: Parse error"
 */
export function formatMermaidError(error: MermaidErrorInfo): string {
  return `[mado] Mermaid error in diagram #${error.index + 1}: ${error.message}`;
}

/**
 * WebView インライン表示向けの罫線ボックス形式エラーを生成する。
 *
 * @example
 * ┌─ Mermaid Error (diagram #1) ─────────┐
 * │ Parse error on line 3                  │
 * │ Source:                                │
 * │   graph TD                             │
 * │     A --> B                            │
 * └────────────────────────────────────────┘
 */
export function formatMermaidErrorBox(error: MermaidErrorInfo): string {
  const headerText = `Mermaid Error (diagram #${error.index + 1})`;
  const contentLines: string[] = [error.message];

  if (error.code.length > 0) {
    contentLines.push("Source:");
    const codeLines = error.code.split("\n").slice(0, 3);
    for (const line of codeLines) {
      contentLines.push(`  ${line}`);
    }
  }

  // ボックス幅の計算（ヘッダーとコンテンツの最大幅）
  const allLines = [headerText, ...contentLines];
  const maxContentWidth = Math.max(...allLines.map((l) => l.length));
  // パディング分を含む幅
  const innerWidth = maxContentWidth + 2;

  const top = `┌─ ${headerText} ${"─".repeat(Math.max(0, innerWidth - headerText.length - 2))}─┐`;
  const bottom = `└─${"─".repeat(innerWidth)}─┘`;
  const body = contentLines
    .map((l) => `│ ${l.padEnd(innerWidth)} │`)
    .join("\n");

  return `${top}\n${body}\n${bottom}`;
}
