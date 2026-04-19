/**
 * 左ペインのファイルエントリ用コンテキストメニュー。
 *
 * - `buildEntryContextMenu(absolutePath, relativePath)`: メニュー構造を返す純粋関数（bun:test で検証可能）
 * - `dispatchEntryContextMenuAction(event, deps)`: クリックイベントをハンドラにルーティング
 * - `installEntryContextMenu(contextMenu, deps)`: FFI 呼び出しを含む実行時インストール（プロセスあたり 1 回のみ）
 *
 * 設計はタスク 019 の `src/bun/menu.ts` の pure + DI + thin install パターンを踏襲する。
 * 詳細はタスク 029 の plan.md / design-review.md を参照。
 */

import * as path from "node:path";
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { log } from "../lib/logger";

// --- アクション識別子 ---
export const ENTRY_COPY_RELATIVE_PATH = "entry:copy-relative-path";
export const ENTRY_COPY_ABSOLUTE_PATH = "entry:copy-absolute-path";
export const ENTRY_COPY_BASENAME = "entry:copy-basename";
export const ENTRY_REVEAL_IN_FINDER = "entry:reveal-in-finder";
export const ENTRY_REMOVE_FROM_LIST = "entry:remove-from-list";

// --- メニューラベル ---
const LABEL_COPY_RELATIVE_PATH = "プロジェクト相対パスをコピー";
const LABEL_COPY_ABSOLUTE_PATH = "フルパスをコピー";
const LABEL_COPY_BASENAME = "ファイル名をコピー";
const LABEL_REVEAL_IN_FINDER = "Finder で表示";
const LABEL_REMOVE_FROM_LIST = "リストから削除";

/**
 * メニュー項目 `data` フィールドのペイロード。
 * `dispatchEntryContextMenuAction` で `hasEntryData` によって型絞り込みする。
 */
export interface EntryContextMenuData {
  absolutePath: string;
  relativePath: string;
}

/**
 * メニューから呼び出される外部依存。
 * 副作用は全てクロージャ経由で注入することで pure ロジックと FFI を分離する。
 */
export interface EntryContextMenuDeps {
  copyToClipboard: (text: string) => void;
  revealInFinder: (absolutePath: string) => void;
  removeFromList: (absolutePath: string) => void;
}

/**
 * context-menu-clicked イベントの最小スキーマ。
 * Electrobun 側では `{ id, action, data }` 形式で発火される。
 */
export interface EntryContextMenuClickEvent {
  action: string;
  data?: unknown;
}

/**
 * メニュー構造を返す純粋関数。
 * 5 アクション + 2 divider の固定構造で、`data` にはクリック元エントリの
 * absolutePath / relativePath を載せる。
 */
export function buildEntryContextMenu(
  absolutePath: string,
  relativePath: string,
): ApplicationMenuItemConfig[] {
  const data: EntryContextMenuData = { absolutePath, relativePath };
  return [
    { label: LABEL_COPY_RELATIVE_PATH, action: ENTRY_COPY_RELATIVE_PATH, data },
    { label: LABEL_COPY_ABSOLUTE_PATH, action: ENTRY_COPY_ABSOLUTE_PATH, data },
    { label: LABEL_COPY_BASENAME, action: ENTRY_COPY_BASENAME, data },
    { type: "divider" },
    { label: LABEL_REVEAL_IN_FINDER, action: ENTRY_REVEAL_IN_FINDER, data },
    { type: "divider" },
    { label: LABEL_REMOVE_FROM_LIST, action: ENTRY_REMOVE_FROM_LIST, data },
  ];
}

/**
 * `data` が `{ absolutePath: string, relativePath: string }` を持つか判定する型ガード。
 */
function hasEntryData(data: unknown): data is EntryContextMenuData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.absolutePath === "string" && typeof d.relativePath === "string";
}

/**
 * クリックイベントをハンドラへディスパッチする純粋関数（IO は deps 経由）。
 *
 * 空文字 absolutePath でも deps は呼ぶ（バリデーションは呼び出し先 (`Utils.*` /
 * `handleClientMessage`) の責務。state 側は存在チェックで no-op になる）。
 */
export function dispatchEntryContextMenuAction(
  event: EntryContextMenuClickEvent,
  deps: EntryContextMenuDeps,
): void {
  if (event.action === ENTRY_COPY_RELATIVE_PATH) {
    if (!hasEntryData(event.data)) {
      log("error", { message: "entry:copy-relative-path: invalid data", action: event.action });
      return;
    }
    log("entry_context_menu_action", {
      action: event.action,
      absolutePath: event.data.absolutePath,
      relativePath: event.data.relativePath,
    });
    deps.copyToClipboard(event.data.relativePath);
    return;
  }

  if (event.action === ENTRY_COPY_ABSOLUTE_PATH) {
    if (!hasEntryData(event.data)) {
      log("error", { message: "entry:copy-absolute-path: invalid data", action: event.action });
      return;
    }
    log("entry_context_menu_action", {
      action: event.action,
      absolutePath: event.data.absolutePath,
      relativePath: event.data.relativePath,
    });
    deps.copyToClipboard(event.data.absolutePath);
    return;
  }

  if (event.action === ENTRY_COPY_BASENAME) {
    if (!hasEntryData(event.data)) {
      log("error", { message: "entry:copy-basename: invalid data", action: event.action });
      return;
    }
    const basename = path.basename(event.data.absolutePath);
    log("entry_context_menu_action", {
      action: event.action,
      absolutePath: event.data.absolutePath,
      relativePath: event.data.relativePath,
    });
    deps.copyToClipboard(basename);
    return;
  }

  if (event.action === ENTRY_REVEAL_IN_FINDER) {
    if (!hasEntryData(event.data)) {
      log("error", { message: "entry:reveal-in-finder: invalid data", action: event.action });
      return;
    }
    log("entry_context_menu_action", {
      action: event.action,
      absolutePath: event.data.absolutePath,
      relativePath: event.data.relativePath,
    });
    deps.revealInFinder(event.data.absolutePath);
    return;
  }

  if (event.action === ENTRY_REMOVE_FROM_LIST) {
    if (!hasEntryData(event.data)) {
      log("error", { message: "entry:remove-from-list: invalid data", action: event.action });
      return;
    }
    log("entry_context_menu_action", {
      action: event.action,
      absolutePath: event.data.absolutePath,
      relativePath: event.data.relativePath,
    });
    deps.removeFromList(event.data.absolutePath);
    return;
  }

  // 未知のアクションは無視（他所で定義された context-menu-clicked が混ざる可能性に備える）
}

/**
 * ContextMenu API の最小契約（side-effect を context-menu.ts から切り離すための DI 用）。
 */
export interface ContextMenuApi {
  showContextMenu: (menu: ApplicationMenuItemConfig[]) => void;
  on: (
    name: "context-menu-clicked",
    handler: (event: unknown) => void,
  ) => void;
}

/**
 * ContextMenu API と deps を受け取り、context-menu-clicked のグローバルリスナーを登録する。
 *
 * 注意: `ContextMenu.on` は ElectrobunEventEmitter を通るアプリ全体の listener なので、
 * **プロセスあたり 1 回だけ呼ぶこと**。複数回呼ぶとハンドラが多重登録される。
 */
export function installEntryContextMenu(
  contextMenu: ContextMenuApi,
  deps: EntryContextMenuDeps,
): void {
  contextMenu.on("context-menu-clicked", (event: unknown) => {
    const parsed = parseClickEvent(event);
    if (!parsed) return;
    try {
      dispatchEntryContextMenuAction(parsed, deps);
    } catch (err) {
      log("error", { message: `dispatchEntryContextMenuAction failed: ${String(err)}` });
    }
  });
}

/**
 * 未知の形式の event から最低限 `{ action, data }` を取り出す。
 * `menu.ts` の `parseClickEvent` と同形。
 */
function parseClickEvent(event: unknown): EntryContextMenuClickEvent | null {
  if (typeof event !== "object" || event === null) return null;
  const record = event as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string") return null;
  return { action, data: record.data };
}
