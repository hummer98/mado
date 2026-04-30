/**
 * ロギング基盤
 *
 * CLAUDE.md §ロギングポリシーに準拠:
 * - フォーマット: [ISO8601+TZ] event_name key1=value1 key2=value2
 * - 1行1イベント
 * - ログファイルパスを起動時に stdout に表示
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { formatTimestamp } from "./format-timestamp.ts";

/** 現在のログファイルパス（initLogger 後に設定） */
let currentLogPath: string | null = null;

/**
 * ログ保存ディレクトリを取得する
 * - テスト時: MADO_LOG_DIR 環境変数で上書き可能
 * - 通常: $TMPDIR/mado/ または ~/.mado/logs/
 */
function getLogDir(): string {
  const envDir = process.env["MADO_LOG_DIR"];
  if (envDir) return envDir;

  const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
  return path.join(tmpDir, "mado");
}

/**
 * キー値ペアを "key=value" 形式の文字列に変換する
 */
function formatData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

/**
 * 現在のログファイルパスを返す。
 * initLogger() を呼ぶ前は空文字列を返す。
 */
export function getLogFilePath(): string {
  return currentLogPath ?? "";
}

/**
 * ロガーを初期化する。
 * ログディレクトリとファイルを作成し、パスを stdout に表示する。
 * 複数回呼ぶと新しいログファイルが作成される。
 */
export function initLogger(): void {
  const logDir = getLogDir();
  mkdirSync(logDir, { recursive: true });

  // ファイル名: mado-<timestamp>-<random>.log
  const timestamp = formatTimestamp(new Date()).replace(/[:.+]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  const fileName = `mado-${timestamp}-${random}.log`;
  currentLogPath = path.join(logDir, fileName);

  // ファイルを作成（空ファイル）
  writeFileSync(currentLogPath, "", { encoding: "utf-8" });

  // CLI stdout にログファイルパスを表示
  console.log(`[mado] ログファイル: ${currentLogPath}`);
}

/**
 * イベントをログファイルに記録する。
 *
 * @param event - イベント名（例: "app_started", "file_opened"）
 * @param data - 追加データ（key=value 形式で記録）
 *
 * @example
 * log("app_started", { version: "0.0.1" });
 * // → [2026-04-12T10:30:00+09:00] app_started version=0.0.1
 */
export function log(event: string, data?: Record<string, unknown>): void {
  const timestamp = formatTimestamp(new Date());
  const dataPart = data && Object.keys(data).length > 0 ? ` ${formatData(data)}` : "";
  const line = `[${timestamp}] ${event}${dataPart}\n`;

  if (currentLogPath) {
    try {
      appendFileSync(currentLogPath, line, { encoding: "utf-8" });
    } catch (err) {
      // ファイル書き込み失敗時は stderr に出力（ログを握りつぶさない）
      console.error(`[mado] log write failed: ${String(err)}`);
    }
  } else {
    // 初期化前の呼び出し: stderr にフォールバック
    console.error(`[mado] logger not initialized: ${line.trim()}`);
  }
}
