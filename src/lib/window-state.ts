/**
 * ウィンドウ状態（サイズ・位置）のプロジェクト単位永続化
 *
 * 保存先: ~/Library/Application Support/mado/window-state.json
 *   {
 *     "<git-root-abs-path>": { width, height, x, y, maximized? },
 *     ...
 *     "__no_git_root__": { ... }  // git 管理外
 *   }
 *
 * - atomic write: tmp 書き込み → rename
 * - 破損時は `.corrupt.<ts>` へ退避して空ストアにフォールバック
 * - 古い corrupt 退避ファイルは保存成功時に最新 1 件を残して削除（§Review 修正 #2）
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
import { debounce } from "./debounce";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// 型・スキーマ
// ---------------------------------------------------------------------------

const BoundsSchema = z.object({
  width: z.number().int().min(200).max(20000),
  height: z.number().int().min(150).max(20000),
  x: z.number().int().min(-10000).max(20000),
  y: z.number().int().min(-10000).max(20000),
  maximized: z.boolean().optional(),
});

const StoreSchema = z.record(z.string(), BoundsSchema);

export type WindowBounds = z.infer<typeof BoundsSchema>;
export type WindowStateStore = z.infer<typeof StoreSchema>;

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

export const NO_GIT_ROOT_KEY = "__no_git_root__";

export const DEFAULT_BOUNDS: WindowBounds = {
  width: 900,
  height: 700,
  x: 0,
  y: 0,
};

const CORRUPT_SUFFIX = ".corrupt.";
const TMP_PREFIX_SEP = ".tmp-";
const MIN_OVERLAP_PX = 80;
const DEFAULT_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

/**
 * デフォルトの保存先 (~/Library/Application Support/mado/window-state.json) を返す。
 * 親ディレクトリが無ければ再帰的に作成する。
 */
export function getWindowStatePath(): string {
  const dir = path.join(os.homedir(), "Library", "Application Support", "mado");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "window-state.json");
}

function resolvePath(filePath: string | undefined): string {
  return filePath ?? getWindowStatePath();
}

// ---------------------------------------------------------------------------
// ロード
// ---------------------------------------------------------------------------

/**
 * 保存済みストアを読み込む。
 * - ファイル不在 → `{}`
 * - パース・検証失敗 → `.corrupt.<ts>` へ退避し `{}` を返す
 */
export function loadWindowStateStore(filePath?: string): WindowStateStore {
  const target = resolvePath(filePath);
  if (!existsSync(target)) return {};
  let raw: string;
  try {
    raw = readFileSync(target, "utf-8");
  } catch (err) {
    log("window_state_load_failed", { reason: `read: ${String(err)}` });
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log("window_state_load_failed", { reason: `json: ${String(err)}` });
    quarantineCorrupt(target);
    return {};
  }

  const result = StoreSchema.safeParse(parsed);
  if (!result.success) {
    log("window_state_load_failed", { reason: `schema: ${result.error.message}` });
    quarantineCorrupt(target);
    return {};
  }
  return result.data;
}

/**
 * 壊れたファイルを `<path>.corrupt.<epoch-ms>` にリネーム退避する。
 * 失敗しても例外は飲み込む（呼び出し元は空ストアで続行）。
 */
function quarantineCorrupt(target: string): void {
  try {
    const dest = `${target}${CORRUPT_SUFFIX}${Date.now()}`;
    renameSync(target, dest);
    log("window_state_quarantined", { dest });
  } catch (err) {
    log("window_state_quarantine_failed", { reason: String(err) });
  }
}

/**
 * ストアから key に紐づく bounds を取り出す。無ければ null。
 */
export function getBoundsForKey(
  store: WindowStateStore,
  key: string,
): WindowBounds | null {
  return store[key] ?? null;
}

// ---------------------------------------------------------------------------
// セーブ
// ---------------------------------------------------------------------------

/**
 * 単一キーの bounds を保存する。atomic write。
 * 失敗時は例外を飲み、ログに残す（起動継続優先）。
 */
export function saveBoundsForKey(
  key: string,
  bounds: WindowBounds,
  filePath?: string,
): void {
  const target = resolvePath(filePath);
  try {
    const parsedBounds = BoundsSchema.parse(bounds);
    const store = loadWindowStateStore(target);
    store[key] = parsedBounds;
    atomicWriteJson(target, store);
    log("window_state_saved", {
      key,
      width: parsedBounds.width,
      height: parsedBounds.height,
      x: parsedBounds.x,
      y: parsedBounds.y,
    });
    pruneCorruptFiles(target);
  } catch (err) {
    log("window_state_save_failed", { reason: String(err), key });
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
 * 保存成功時に `.corrupt.*` ファイルを最新 1 件だけ残してそれ以外を削除する。
 * 失敗しても無視（掃除は best-effort）。
 */
function pruneCorruptFiles(target: string): void {
  try {
    const dir = path.dirname(target);
    const base = path.basename(target);
    const corrupts = readdirSync(dir)
      .filter((f) => f.startsWith(`${base}${CORRUPT_SUFFIX}`) || f.includes(CORRUPT_SUFFIX))
      .filter((f) => f.startsWith(base) || f.includes("window-state.json.corrupt"))
      .sort(); // 名前順 = タイムスタンプ順（後ろほど新しい）
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

// ---------------------------------------------------------------------------
// クランプ（画面外補正）
// ---------------------------------------------------------------------------

export interface ClampDisplay {
  workArea: { x: number; y: number; width: number; height: number };
}

/**
 * bounds が少なくとも 1 枚の workArea と十分に重なっているかを判定し、
 * 外れていれば workArea 内に収まるよう補正して返す。
 *
 * - 重なり 80px 以上 → そのまま
 * - どれとも十分重ならない → workArea[0] の中央に配置、サイズは workArea に収まるようクリップ
 * - `displays` が空 → `DEFAULT_BOUNDS`
 */
export function clampBoundsToDisplays(
  bounds: WindowBounds,
  displays: ClampDisplay[],
): WindowBounds {
  if (displays.length === 0) return { ...DEFAULT_BOUNDS };

  for (const d of displays) {
    if (hasEnoughOverlap(bounds, d.workArea)) {
      return { ...bounds };
    }
  }

  // フォールバック: 最初の workArea に収める
  const wa = displays[0]!.workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  const x = wa.x + Math.max(0, Math.floor((wa.width - width) / 2));
  const y = wa.y + Math.max(0, Math.floor((wa.height - height) / 2));
  const result: WindowBounds = { width, height, x, y };
  if (bounds.maximized !== undefined) result.maximized = bounds.maximized;
  return result;
}

function hasEnoughOverlap(
  bounds: WindowBounds,
  workArea: { x: number; y: number; width: number; height: number },
): boolean {
  const ox = Math.max(
    0,
    Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x),
  );
  const oy = Math.max(
    0,
    Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y),
  );
  return ox >= MIN_OVERLAP_PX && oy >= MIN_OVERLAP_PX;
}

// ---------------------------------------------------------------------------
// キー解決
// ---------------------------------------------------------------------------

export function resolveStateKey(gitRoot: string | null): string {
  return gitRoot ?? NO_GIT_ROOT_KEY;
}

// ---------------------------------------------------------------------------
// Debounced セーバー
// ---------------------------------------------------------------------------

export interface WindowStateSaver {
  schedule: (bounds: WindowBounds) => void;
  flush: () => void;
  dispose: () => void;
}

export interface CreateSaverOptions {
  key: string;
  filePath?: string;
  delayMs?: number;
}

/**
 * resize/move イベントから呼び出す debounced セーバー。
 * - `schedule(bounds)`: 最新 bounds を保留し delayMs 後に保存
 * - `flush()`: 保留中があれば即同期保存（before-quit / close 用）
 * - `dispose()`: タイマー解除後、以降の schedule/flush を無効化
 */
export function createWindowStateSaver(
  opts: CreateSaverOptions,
): WindowStateSaver {
  const { key, filePath, delayMs = DEFAULT_DEBOUNCE_MS } = opts;
  let pending: WindowBounds | null = null;
  let disposed = false;

  const flushInternal = (): void => {
    if (pending === null) return;
    const toSave = pending;
    pending = null;
    saveBoundsForKey(key, toSave, filePath);
  };

  const debounced = debounce((..._args: unknown[]): void => {
    if (disposed) return;
    flushInternal();
  }, delayMs);

  return {
    schedule: (bounds: WindowBounds): void => {
      if (disposed) return;
      pending = bounds;
      debounced.call();
    },
    flush: (): void => {
      if (disposed) return;
      debounced.cancel();
      flushInternal();
    },
    dispose: (): void => {
      debounced.cancel();
      pending = null;
      disposed = true;
    },
  };
}
