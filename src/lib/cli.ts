/**
 * CLI 引数パース + バリデーション
 *
 * Zod を使用して CLI 引数をバリデーションする。
 * 結果は Result 型で返し、呼び出し側で exit を制御する。
 */

import { z } from "zod";
import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * CLI 引数の Zod スキーマ
 * CLAUDE.md: 外部入力は Zod でバリデーションする
 */
const CliArgsSchema = z.object({
  filePath: z.string().min(1, "ファイルパスを指定してください"),
});

/** パース成功時の結果 */
export type CliArgsOk = {
  ok: true;
  filePath: string;
  warnings: string[];
};

/** パース失敗時の結果 */
export type CliArgsError = {
  ok: false;
  error: string;
};

/** CLI 引数パース結果 */
export type ParseResult = CliArgsOk | CliArgsError;

/**
 * CLI 引数をパースしてバリデーションする。
 *
 * @param argv - process.argv 相当の配列
 * @returns パース結果（成功: ファイルパス + 警告、失敗: エラーメッセージ）
 */
export function parseCliArgs(argv: string[]): ParseResult {
  const args = argv.slice(2);
  const warnings: string[] = [];
  let rawPath: string;

  if (args.length === 0) {
    // デフォルト: カレントディレクトリの README.md
    rawPath = "README.md";
  } else {
    rawPath = args[0];
  }

  const filePath = path.resolve(rawPath);

  // Zod でバリデーション
  const zodResult = CliArgsSchema.safeParse({ filePath });
  if (!zodResult.success) {
    return { ok: false, error: zodResult.error.issues[0].message };
  }

  // ファイル存在チェック
  if (!existsSync(filePath)) {
    return { ok: false, error: `ファイルが見つかりません: ${filePath}` };
  }

  // Markdown 以外の拡張子チェック（警告のみ、エラーにはしない）
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    warnings.push(`Markdown ファイルではない可能性があります (${ext})`);
  }

  return { ok: true, filePath, warnings };
}
