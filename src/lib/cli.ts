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

/**
 * ファイルパスの由来を示す Zod enum。
 * - argv: コマンドライン引数から取得
 * - env: 環境変数 MADO_FILE から取得
 * - default: デフォルト値 "README.md"
 */
export const CliPathSourceSchema = z.enum(["argv", "env", "default"]);
export type CliPathSource = z.infer<typeof CliPathSourceSchema>;

/** パース成功時の結果 */
export type CliArgsOk = {
  ok: true;
  filePath: string;
  source: CliPathSource;
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
 * 優先順位: argv[2] > env.MADO_FILE > デフォルト "README.md"
 *
 * launcher は引数を forwarding しないため、env 経由で渡されるケースをサポートする。
 * env 由来の相対パスも `path.resolve()` で正規化するが、launcher の cwd は
 * `Contents/MacOS/` で予期しない解決になるため、呼び出し側 (`bin/mado`) が
 * 絶対パス化する責任を持つ（idempotent）。
 *
 * @param argv - process.argv 相当の配列
 * @param env - 環境変数オブジェクト（テスト容易性のため注入可能）
 * @returns パース結果（成功: ファイルパス + 由来 + 警告、失敗: エラーメッセージ）
 */
export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParseResult {
  const args = argv.slice(2);
  const warnings: string[] = [];
  let rawPath: string;
  let source: CliPathSource;

  if (args.length > 0) {
    rawPath = args[0];
    source = "argv";
  } else if (typeof env.MADO_FILE === "string" && env.MADO_FILE.length > 0) {
    rawPath = env.MADO_FILE;
    source = "env";
  } else {
    rawPath = "README.md";
    source = "default";
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

  return { ok: true, filePath, source, warnings };
}
