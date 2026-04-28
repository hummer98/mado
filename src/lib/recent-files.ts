/**
 * Open Recent 履歴の永続化
 *
 * 保存先: ~/Library/Application Support/mado/recent-files.json
 *   {
 *     "version": 1,
 *     "files": [
 *       "/Users/foo/git/mado/README.md",
 *       "/Users/foo/notes/draft.md"
 *     ]
 *   }
 *
 * - 上限 10 件、新しい順（先頭が最新）
 * - 重複は先頭に持ち上げ（順序入れ替え）
 * - atomic write: tmp 書き込み → rename
 * - 破損時 / version 不一致: `.corrupt.<ts>` へ退避し空ストアにフォールバック
 * - 起動時 (loadRecentFiles) は履歴中の存在しないパスを除去して書き戻す
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
// 定数・スキーマ
// ---------------------------------------------------------------------------

export const MAX_RECENT_FILES = 10;

const RecentFilesSchemaV1 = z.object({
  version: z.literal(1),
  files: z.array(z.string().min(1)).max(MAX_RECENT_FILES),
});

type RecentFilesStore = z.infer<typeof RecentFilesSchemaV1>;

const CORRUPT_SUFFIX = ".corrupt.";
const TMP_PREFIX_SEP = ".tmp-";

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

/**
 * デフォルト保存先 (~/Library/Application Support/mado/recent-files.json) を返す。
 * 親ディレクトリが無ければ再帰的に作成する。
 */
export function getRecentFilesPath(): string {
  const dir = path.join(os.homedir(), "Library", "Application Support", "mado");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "recent-files.json");
}

function resolveStorePath(filePath: string | undefined): string {
  return filePath ?? getRecentFilesPath();
}

// ---------------------------------------------------------------------------
// I/O ヘルパ
// ---------------------------------------------------------------------------

function quarantineCorrupt(target: string): void {
  try {
    const dest = `${target}${CORRUPT_SUFFIX}${Date.now()}`;
    renameSync(target, dest);
    log("recent_files_quarantined", { dest });
  } catch (err) {
    log("recent_files_quarantine_failed", { reason: String(err) });
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
 * 永続化ファイルから生のストアをロードする（存在チェックは呼び出し側で行う）。
 * パース・スキーマ違反は `.corrupt.<ts>` 退避 + 空ストアにフォールバック。
 */
function readStore(target: string): RecentFilesStore {
  if (!existsSync(target)) return { version: 1, files: [] };

  let raw: string;
  try {
    raw = readFileSync(target, "utf-8");
  } catch (err) {
    log("recent_files_load_failed", { reason: `read: ${String(err)}` });
    return { version: 1, files: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log("recent_files_load_failed", { reason: `json: ${String(err)}` });
    quarantineCorrupt(target);
    return { version: 1, files: [] };
  }

  // version 不一致は schema 側でも弾けるが、より具体的なログを出すため先に判定する。
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version !== 1
  ) {
    log("recent_files_load_failed", {
      reason: `version_mismatch: ${String((parsed as { version?: unknown }).version)}`,
    });
    quarantineCorrupt(target);
    return { version: 1, files: [] };
  }

  const result = RecentFilesSchemaV1.safeParse(parsed);
  if (!result.success) {
    log("recent_files_load_failed", { reason: `schema: ${result.error.message}` });
    quarantineCorrupt(target);
    return { version: 1, files: [] };
  }
  return result.data;
}

function writeStore(target: string, files: string[]): void {
  try {
    const store: RecentFilesStore = { version: 1, files: files.slice(0, MAX_RECENT_FILES) };
    atomicWriteJson(target, store);
    pruneCorruptFiles(target);
  } catch (err) {
    log("recent_files_save_failed", { reason: String(err) });
  }
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 起動時に呼ぶ。破損 → 空ストア。存在しないファイルは取り除いて書き戻す。
 */
export function loadRecentFiles(filePath?: string): string[] {
  const target = resolveStorePath(filePath);
  const store = readStore(target);
  const filtered = store.files.filter((p) => existsSync(p));
  if (filtered.length !== store.files.length) {
    log("recent_files_pruned", {
      before: store.files.length,
      after: filtered.length,
    });
    writeStore(target, filtered);
  }
  log("recent_files_loaded", { count: filtered.length });
  return filtered;
}

/**
 * 履歴に追加する。
 * - 重複排除（先頭に持ち上げ）
 * - 上限切り捨て
 * - atomic write
 * - 返り値は更新後の配列
 */
export function addRecentFile(absolutePath: string, filePath?: string): string[] {
  const target = resolveStorePath(filePath);
  const normalized = path.resolve(absolutePath);
  const store = readStore(target);
  const without = store.files.filter((p) => p !== normalized);
  const next = [normalized, ...without].slice(0, MAX_RECENT_FILES);
  writeStore(target, next);
  log("recent_file_added", { path: normalized, total: next.length });
  return next;
}

/**
 * 単一エントリを除去する。clicked-but-missing の経路で使う。
 * 該当が無ければ no-op で現状の配列を返す。
 */
export function removeRecentFile(absolutePath: string, filePath?: string): string[] {
  const target = resolveStorePath(filePath);
  const normalized = path.resolve(absolutePath);
  const store = readStore(target);
  const next = store.files.filter((p) => p !== normalized);
  if (next.length !== store.files.length) {
    writeStore(target, next);
  }
  return next;
}

/**
 * 履歴を空にする（ファイル自体は `{ version:1, files:[] }` で残す）。
 */
export function clearRecentFiles(filePath?: string): void {
  const target = resolveStorePath(filePath);
  writeStore(target, []);
}
