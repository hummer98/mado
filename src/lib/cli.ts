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
 *
 * 引数も env も無い場合は welcome モードとして扱い source は持たない
 * (Task 020 で "default" 由来を除外)。
 */
export const CliPathSourceSchema = z.enum(["argv", "env"]);
export type CliPathSource = z.infer<typeof CliPathSourceSchema>;

/** ファイルモード (argv / env でパスが確定した場合) */
export type CliArgsFileOk = {
  ok: true;
  mode: "file";
  filePath: string;
  source: CliPathSource;
  warnings: string[];
};

/** welcome モード (引数も env も与えられなかった場合) */
export type CliArgsWelcome = {
  ok: true;
  mode: "welcome";
};

/** パース失敗時の結果 */
export type CliArgsError = {
  ok: false;
  error: string;
};

/** CLI 引数パース結果 */
export type ParseResult = CliArgsFileOk | CliArgsWelcome | CliArgsError;

/**
 * CLI 引数をパースしてバリデーションする。
 *
 * 優先順位: argv[2] > env.MADO_FILE。どちらもなければ welcome モード。
 *
 * launcher は引数を forwarding しないため、env 経由で渡されるケースをサポートする。
 * env 由来の相対パスも `path.resolve()` で正規化するが、launcher の cwd は
 * `Contents/MacOS/` で予期しない解決になるため、呼び出し側 (`bin/mado`) が
 * 絶対パス化する責任を持つ（idempotent）。
 *
 * @param argv - process.argv 相当の配列
 * @param env - 環境変数オブジェクト（テスト容易性のため注入可能）
 * @returns パース結果（file モード / welcome モード / エラー）
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
    // 引数も env も無い → Finder / Launchpad 起動 or launcher 無し CLI
    return { ok: true, mode: "welcome" };
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

  return { ok: true, mode: "file", filePath, source, warnings };
}
