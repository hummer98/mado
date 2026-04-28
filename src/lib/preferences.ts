/**
 * グローバル preferences の永続化
 *
 * 保存先: ~/Library/Application Support/mado/preferences.json
 *   {
 *     "version": 1,
 *     "wideLayout": false
 *   }
 *
 * - atomic write: tmp 書き込み → rename
 * - 破損時 / version 不一致 / schema 不一致: `.corrupt.<ts>` へ退避し
 *   DEFAULT_PREFERENCES にフォールバック
 * - recent-files.ts / window-state.ts と異なり「git root 単位」ではなく
 *   ユーザー全体で 1 ファイル（グローバル設定）
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// スキーマ・既定値
// ---------------------------------------------------------------------------

const PreferencesSchemaV1 = z.object({
  version: z.literal(1),
  wideLayout: z.boolean(),
});

type PreferencesStore = z.infer<typeof PreferencesSchemaV1>;

/** アプリ全体で共有される設定値 */
export interface Preferences {
  /** View > Wide Layout: true で .markdown-body の max-width を解除する */
  wideLayout: boolean;
}

/** 初回起動時 / 破損時のフォールバック値 */
export const DEFAULT_PREFERENCES: Preferences = {
  wideLayout: false,
};

const CORRUPT_SUFFIX = ".corrupt.";
const TMP_PREFIX_SEP = ".tmp-";

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

/**
 * デフォルト保存先 (~/Library/Application Support/mado/preferences.json) を返す。
 * 親ディレクトリが無ければ再帰的に作成する。
 */
export function getPreferencesPath(): string {
  const dir = path.join(os.homedir(), "Library", "Application Support", "mado");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "preferences.json");
}

function resolveStorePath(filePath: string | undefined): string {
  return filePath ?? getPreferencesPath();
}

// ---------------------------------------------------------------------------
// I/O ヘルパ
// ---------------------------------------------------------------------------

function quarantineCorrupt(target: string): void {
  try {
    const dest = `${target}${CORRUPT_SUFFIX}${Date.now()}`;
    renameSync(target, dest);
    log("preferences_quarantined", { dest });
  } catch (err) {
    log("preferences_quarantine_failed", { reason: String(err) });
  }
}

function atomicWriteJson(target: string, data: unknown): void {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const tmp = path.join(
    dir,
    `${base}${TMP_PREFIX_SEP}${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8" });
  renameSync(tmp, target);
}

/**
 * 保存成功時に `.corrupt.*` を最新 1 件だけ残してそれ以外を削除する。
 * 失敗しても無視（掃除は best-effort）。
 */
function pruneCorruptFiles(target: string): void {
  try {
    const dir = path.dirname(target);
    const base = path.basename(target);
    const corrupts = readdirSync(dir)
      .filter((f) => f.startsWith(`${base}${CORRUPT_SUFFIX}`))
      .sort();
    if (corrupts.length <= 1) return;
    const toDelete = corrupts.slice(0, corrupts.length - 1);
    for (const f of toDelete) {
      try {
        unlinkSync(path.join(dir, f));
      } catch {
        // 個別失敗は無視
      }
    }
  } catch {
    // ディレクトリ走査失敗は無視
  }
}

/**
 * 永続化ファイルから生のストアをロードする。
 * パース・スキーマ違反は `.corrupt.<ts>` 退避 + DEFAULT 相当のストアにフォールバック。
 */
function readStore(target: string): PreferencesStore {
  if (!existsSync(target)) {
    return { version: 1, wideLayout: DEFAULT_PREFERENCES.wideLayout };
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf-8");
  } catch (err) {
    log("preferences_load_failed", { reason: `read: ${String(err)}` });
    return { version: 1, wideLayout: DEFAULT_PREFERENCES.wideLayout };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log("preferences_load_failed", { reason: `json: ${String(err)}` });
    quarantineCorrupt(target);
    return { version: 1, wideLayout: DEFAULT_PREFERENCES.wideLayout };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version !== 1
  ) {
    log("preferences_load_failed", {
      reason: `version_mismatch: ${String((parsed as { version?: unknown }).version)}`,
    });
    quarantineCorrupt(target);
    return { version: 1, wideLayout: DEFAULT_PREFERENCES.wideLayout };
  }

  const result = PreferencesSchemaV1.safeParse(parsed);
  if (!result.success) {
    log("preferences_load_failed", { reason: `schema: ${result.error.message}` });
    quarantineCorrupt(target);
    return { version: 1, wideLayout: DEFAULT_PREFERENCES.wideLayout };
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 起動時に呼ぶ。破損 / 不在 → DEFAULT_PREFERENCES 相当を返す。
 */
export function loadPreferences(filePath?: string): Preferences {
  const target = resolveStorePath(filePath);
  const store = readStore(target);
  log("preferences_loaded", { wideLayout: store.wideLayout });
  return { wideLayout: store.wideLayout };
}

/**
 * 設定を保存する。atomic write。失敗時はログのみで例外を飲む。
 */
export function savePreferences(prefs: Preferences, filePath?: string): void {
  const target = resolveStorePath(filePath);
  try {
    const store: PreferencesStore = { version: 1, wideLayout: prefs.wideLayout };
    atomicWriteJson(target, store);
    pruneCorruptFiles(target);
    log("preferences_saved", { wideLayout: prefs.wideLayout });
  } catch (err) {
    log("preferences_save_failed", { reason: String(err) });
  }
}
