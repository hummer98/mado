/**
 * CLI 引数パース + バリデーション
 *
 * Zod を使用して CLI 引数をバリデーションする。
 * 結果は Result 型で返し、呼び出し側で exit を制御する。
 *
 * ディレクトリ指定 (`mado <dir>` / `mado -r <dir>`) にも対応する。
 * ParseResult は discriminated union で file / directory / welcome / error を区別する。
 */

import { z } from "zod";
import { existsSync, statSync } from "node:fs";
import * as path from "node:path";

/**
 * CLI 引数の Zod スキーマ
 * CLAUDE.md: 外部入力は Zod でバリデーションする
 */
const CliArgsSchema = z.object({
  filePath: z.string().min(1, "ファイルパスを指定してください"),
});

const CliDirectorySchema = z.object({
  dirPath: z.string().min(1, "ディレクトリパスを指定してください"),
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

/** ディレクトリモード (argv にディレクトリパスが与えられた場合) */
export type CliArgsDirectoryOk = {
  ok: true;
  mode: "directory";
  dirPath: string;
  recursive: boolean;
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
export type ParseResult =
  | CliArgsFileOk
  | CliArgsDirectoryOk
  | CliArgsWelcome
  | CliArgsError;

/**
 * statSync のエラーから errno に応じたユーザー向けメッセージを生成する。
 */
function messageForStatError(targetPath: string, err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  switch (code) {
    case "ENOENT":
      return `ファイルが見つかりません: ${targetPath}`;
    case "EACCES":
      return `アクセス権限がありません: ${targetPath}`;
    case "ELOOP":
      return `シンボリックリンクがループしています: ${targetPath}`;
    default: {
      const detail = code !== "" ? code : err instanceof Error ? err.message : String(err);
      return `パスを開けませんでした: ${targetPath} (${detail})`;
    }
  }
}

type Partitioned = {
  positionals: string[];
  recursive: boolean;
};

/**
 * argv.slice(2) から `-r` / `--recursive` フラグを抽出し、残りを positional として返す。
 */
function partitionArgs(args: string[]): Partitioned {
  const positionals: string[] = [];
  let recursive = false;
  for (const a of args) {
    if (a === "-r" || a === "--recursive") {
      recursive = true;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, recursive };
}

/**
 * CLI 引数をパースしてバリデーションする。
 *
 * 優先順位: argv[2+] > env.MADO_FILE。どちらもなければ welcome モード。
 *
 * launcher は引数を forwarding しないため、env 経由で渡されるケースをサポートする。
 * env 由来の相対パスも `path.resolve()` で正規化するが、launcher の cwd は
 * `Contents/MacOS/` で予期しない解決になるため、呼び出し側 (`bin/mado`) が
 * 絶対パス化する責任を持つ（idempotent）。env 由来は file モード専用であり
 * ディレクトリは未対応（plan.md §要確認事項 #1）。
 *
 * @param argv - process.argv 相当の配列
 * @param env - 環境変数オブジェクト（テスト容易性のため注入可能）
 * @returns パース結果（file / directory / welcome モード / エラー）
 */
export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParseResult {
  const args = argv.slice(2);
  const { positionals, recursive } = partitionArgs(args);
  const warnings: string[] = [];

  // positional 2 つ以上は未対応。
  if (positionals.length >= 2) {
    return { ok: false, error: "複数のパス指定は未対応です" };
  }

  let rawPath: string;
  let source: CliPathSource;

  if (positionals.length === 1) {
    rawPath = positionals[0];
    source = "argv";
  } else if (typeof env.MADO_FILE === "string" && env.MADO_FILE.length > 0) {
    // -r フラグ + env.MADO_FILE (argv に positional なし) の組合せは誤用として早期エラー。
    // plan.md §2-1 step 5: env 由来 file + `-r` も同じ扱い。
    if (recursive) {
      return {
        ok: false,
        error: "-r はディレクトリ指定時のみ有効です (env.MADO_FILE との組合せ)",
      };
    }
    rawPath = env.MADO_FILE;
    source = "env";
  } else {
    // 引数も env も無い → Finder / Launchpad 起動 or launcher 無し CLI。
    // `-r` 単独での起動は warning 扱いで welcome を継続する (plan.md §8 エッジケース)。
    return { ok: true, mode: "welcome" };
  }

  const resolvedPath = path.resolve(rawPath);

  // env 由来は既存挙動どおり file 専用として処理する。
  // ディレクトリが入っていても拡張子警告付きで file モードに流すが、
  // 下流の fs 読み込みで失敗することで実害は限定的（plan.md §要確認事項 #1）。
  if (source === "env") {
    const zodResult = CliArgsSchema.safeParse({ filePath: resolvedPath });
    if (!zodResult.success) {
      return { ok: false, error: zodResult.error.issues[0].message };
    }
    if (!existsSync(resolvedPath)) {
      return { ok: false, error: `ファイルが見つかりません: ${resolvedPath}` };
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext !== ".md" && ext !== ".markdown") {
      warnings.push(`Markdown ファイルではない可能性があります (${ext})`);
    }
    return { ok: true, mode: "file", filePath: resolvedPath, source, warnings };
  }

  // argv 由来: statSync で file / directory を判別。
  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (err) {
    return { ok: false, error: messageForStatError(resolvedPath, err) };
  }

  if (stat.isDirectory()) {
    const dirResult = CliDirectorySchema.safeParse({ dirPath: resolvedPath });
    if (!dirResult.success) {
      return { ok: false, error: dirResult.error.issues[0].message };
    }
    return {
      ok: true,
      mode: "directory",
      dirPath: resolvedPath,
      recursive,
      source,
      warnings,
    };
  }

  // stat.isFile() or 他 (block/char/socket 等) は file として扱いを試みる。
  // ただし `-r <file>` は誤用なので早期エラー。
  if (recursive) {
    return {
      ok: false,
      error: `-r はディレクトリ指定時のみ有効です: ${resolvedPath}`,
    };
  }

  const fileResult = CliArgsSchema.safeParse({ filePath: resolvedPath });
  if (!fileResult.success) {
    return { ok: false, error: fileResult.error.issues[0].message };
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    warnings.push(`Markdown ファイルではない可能性があります (${ext})`);
  }

  return { ok: true, mode: "file", filePath: resolvedPath, source, warnings };
}
