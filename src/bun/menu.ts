/**
 * macOS アプリケーションメニュー構築とイベントディスパッチ。
 *
 * - `buildApplicationMenu(deps)`: メニュー構造を返す純粋関数。bun:test で検証可能
 * - `dispatchMenuAction(event, deps)`: クリックイベントをハンドラにルーティング
 * - `installApplicationMenu(deps)`: FFI 呼び出しを含む実行時インストール
 *
 * 詳細はタスク 019 の plan.md / review.md を参照。
 */

import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { log } from "../lib/logger";
import { createT, detectLocale } from "../lib/locale";
import type { Locale } from "../lib/locale";

// --- アクション識別子 ---
export const FILE_OPEN_ACTION = "file:open";
export const FILE_OPEN_RECENT_ACTION = "file:open-recent";
export const APP_PREFERENCES_ACTION = "app:preferences";
export const WINDOW_FOCUS_ACTION = "window:focus";
export const VIEW_ZOOM_IN_ACTION = "view:zoom-in";
export const VIEW_ZOOM_OUT_ACTION = "view:zoom-out";
export const VIEW_ZOOM_RESET_ACTION = "view:zoom-reset";

// --- アクセラレータ (Electrobun は Swift 側へ文字列をそのまま渡す)。
// GlobalShortcut.register の例に倣い "CommandOrControl+..." 記法を採用するが、
// 手動検証で動かない場合は "Cmd+..." 等を Implementer が試す。
export const ACCELERATOR_QUIT = "CommandOrControl+Q";
export const ACCELERATOR_HIDE = "CommandOrControl+H";
export const ACCELERATOR_HIDE_OTHERS = "CommandOrControl+Alt+H";
export const ACCELERATOR_PREFERENCES = "CommandOrControl+,";
export const ACCELERATOR_OPEN = "CommandOrControl+O";
export const ACCELERATOR_CLOSE = "CommandOrControl+W";
export const ACCELERATOR_MINIMIZE = "CommandOrControl+M";
// JIS キーボードで "=" accelerator が `Cmd+;` に化ける問題への対応。
// `Plus` を key として登録 → NSMenuItem 側で "+" 文字 + Shift modifier と扱われ
//   - US 配列: Cmd+Shift+= (= "+" を入力するときと同じ操作)
//   - JIS 配列: Cmd+Shift+; (= "+" を入力するときと同じ操作)
// で発火し、メニュー表示も ⌘+ になり Chrome / Safari の表示慣例とも揃う。
// `++` だと accelerator parser が `+` を separator として split したあとに空の
// key 名が残って解釈不能になるため、Electron/Chromium の慣例どおり `Plus` を使う。
export const ACCELERATOR_ZOOM_IN = "CommandOrControl+Plus";
export const ACCELERATOR_ZOOM_OUT = "CommandOrControl+-";
export const ACCELERATOR_ZOOM_RESET = "CommandOrControl+0";


// --- 対応拡張子 ---
const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

/**
 * Window メニュー末尾で動的展開するためのウィンドウ概要。
 */
export interface WindowSummary {
  id: number;
  title: string;
}

/**
 * メニューから呼び出される外部依存。
 * 実装を疎結合に保つため、副作用は全てクロージャ経由で注入する。
 */
export interface MenuDeps {
  /** ファイルパスを mado にオープンさせる（既存の addFile 経路をラップ） */
  openMarkdownFile: (absolutePath: string) => void;
  /** Window メニュー末尾に展開するウィンドウ一覧を返す */
  listWindows: () => WindowSummary[];
  /** 指定ウィンドウにフォーカスを移す */
  focusWindowById: (id: number) => void;
  /**
   * ファイル選択ダイアログを開く。
   * 既定では Utils.openFileDialog を呼ぶが、テストではモックを渡せる。
   */
  openFileDialog: (opts: {
    startingFolder?: string;
    allowedFileTypes?: string;
    canChooseFiles?: boolean;
    canChooseDirectory?: boolean;
    allowsMultipleSelection?: boolean;
  }) => Promise<string[]>;
  /** View > 拡大 (⌘+) ハンドラ。WebView 側の __MADO_ZOOM_IN__ を呼ぶ想定。 */
  zoomIn: () => void;
  /** View > 縮小 (⌘-) ハンドラ。WebView 側の __MADO_ZOOM_OUT__ を呼ぶ想定。 */
  zoomOut: () => void;
  /** View > 実寸 (⌘0) ハンドラ。WebView 側の __MADO_ZOOM_RESET__ を呼ぶ想定。 */
  zoomReset: () => void;
}

/**
 * application-menu-clicked イベントの最小スキーマ。
 * Electrobun 側では `{ id, action, data }` 形式で発火される。
 */
export interface MenuClickEvent {
  action: string;
  data?: unknown;
}

/**
 * メニュー構造を返す純粋関数。
 * `deps.listWindows()` の戻り値を Window メニュー末尾に展開する以外は静的。
 * `locale` を省略するとシステムロケールを自動検出する（テストでは明示的に渡す）。
 */
export function buildApplicationMenu(deps: MenuDeps, locale: Locale = detectLocale()): ApplicationMenuItemConfig[] {
  const t = createT(locale);
  const appMenu: ApplicationMenuItemConfig = {
    label: t("app"),
    submenu: [
      { role: "about" },
      { type: "divider" },
      {
        label: t("preferences"),
        action: APP_PREFERENCES_ACTION,
        accelerator: ACCELERATOR_PREFERENCES,
        enabled: false,
      },
      { type: "divider" },
      { role: "hide", label: t("hide"), accelerator: ACCELERATOR_HIDE },
      { role: "hideOthers", label: t("hideOthers"), accelerator: ACCELERATOR_HIDE_OTHERS },
      { role: "showAll", label: t("showAll") },
      { type: "divider" },
      { role: "quit", label: t("quit"), accelerator: ACCELERATOR_QUIT },
    ],
  };

  const fileMenu: ApplicationMenuItemConfig = {
    label: t("file"),
    submenu: [
      {
        label: t("open"),
        action: FILE_OPEN_ACTION,
        accelerator: ACCELERATOR_OPEN,
      },
      {
        label: t("openRecent"),
        action: FILE_OPEN_RECENT_ACTION,
        enabled: false,
        submenu: [],
      },
      { type: "divider" },
      { role: "close", accelerator: ACCELERATOR_CLOSE },
    ],
  };

  // Edit メニュー: ⌘C 等のショートカットは macOS 既定に任せるため
  // accelerator は明示せず role のみを指定する。
  // macOS は "Edit" ラベルを手掛かりに Emoji & Symbols 等を自動挿入するため、
  // 日本語環境でも t("edit") の値が影響しないよう role に任せて動作検証すること。
  const editMenu: ApplicationMenuItemConfig = {
    label: t("edit"),
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "divider" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  };

  const dynamicWindows: ApplicationMenuItemConfig[] = deps
    .listWindows()
    .map((w) => ({
      label: w.title,
      action: WINDOW_FOCUS_ACTION,
      data: { winId: w.id },
    }));

  const windowSubmenu: ApplicationMenuItemConfig[] = [
    { role: "minimize", label: t("minimize"), accelerator: ACCELERATOR_MINIMIZE },
    { role: "zoom", label: t("zoom") },
    { type: "divider" },
    { role: "bringAllToFront", label: t("bringAllToFront") },
  ];
  if (dynamicWindows.length > 0) {
    windowSubmenu.push({ type: "divider" });
    windowSubmenu.push(...dynamicWindows);
  }

  const windowMenu: ApplicationMenuItemConfig = {
    label: t("window"),
    submenu: windowSubmenu,
  };

  // View メニュー: ⌘+/⌘-/⌘0 で .markdown-body を 50-200% ズーム (T032)。
  // クリックハンドラは dispatchMenuAction → deps.zoomIn/Out/Reset を経由して
  // WebView の __MADO_ZOOM_* グローバル関数に到達する。
  const viewMenu: ApplicationMenuItemConfig = {
    label: t("view"),
    submenu: [
      {
        label: t("zoomIn"),
        action: VIEW_ZOOM_IN_ACTION,
        accelerator: ACCELERATOR_ZOOM_IN,
      },
      {
        label: t("zoomOut"),
        action: VIEW_ZOOM_OUT_ACTION,
        accelerator: ACCELERATOR_ZOOM_OUT,
      },
      {
        label: t("actualSize"),
        action: VIEW_ZOOM_RESET_ACTION,
        accelerator: ACCELERATOR_ZOOM_RESET,
      },
    ],
  };

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu];
}

/**
 * `data` が `{ winId: number }` を持つか判定する型ガード。
 */
function hasWinId(data: unknown): data is { winId: number } {
  if (typeof data !== "object" || data === null) return false;
  const value = (data as { winId?: unknown }).winId;
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 選択されたパスが対応拡張子を持つか判定する。
 */
function isMarkdownPath(p: string): boolean {
  const lower = p.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * クリックイベントをハンドラへディスパッチする純粋関数（IO は deps 経由）。
 *
 * - `file:open`: openFileDialog → キャンセル/拡張子ガード → openMarkdownFile
 * - `window:focus`: data.winId で focusWindowById
 * - その他: 何もしない（role は native 側が処理するため JS コールバックは発火しない想定）
 */
export async function dispatchMenuAction(
  event: MenuClickEvent,
  deps: MenuDeps,
): Promise<void> {
  if (event.action === FILE_OPEN_ACTION) {
    let paths: string[] = [];
    try {
      paths = await deps.openFileDialog({
        canChooseDirectory: false,
        allowsMultipleSelection: false,
        allowedFileTypes: "md,markdown",
      });
    } catch (err) {
      log("error", { message: `openFileDialog failed: ${String(err)}` });
      return;
    }

    const first = paths[0];
    if (typeof first !== "string" || first === "") {
      // キャンセル、または空結果
      return;
    }
    if (!isMarkdownPath(first)) {
      log("menu_open_rejected", { reason: "non_markdown_extension", path: first });
      return;
    }
    deps.openMarkdownFile(first);
    return;
  }

  if (event.action === WINDOW_FOCUS_ACTION) {
    if (!hasWinId(event.data)) {
      log("error", { message: "window:focus: invalid data", action: event.action });
      return;
    }
    deps.focusWindowById(event.data.winId);
    return;
  }

  if (event.action === VIEW_ZOOM_IN_ACTION) {
    deps.zoomIn();
    return;
  }
  if (event.action === VIEW_ZOOM_OUT_ACTION) {
    deps.zoomOut();
    return;
  }
  if (event.action === VIEW_ZOOM_RESET_ACTION) {
    deps.zoomReset();
    return;
  }

  // 未知のアクションは無視（role 系は native 側が処理するためここには来ない）
}

/**
 * ApplicationMenu API の最小契約（side-effect を menu.ts から切り離すための DI 用）。
 */
export interface ApplicationMenuApi {
  setApplicationMenu: (menu: ApplicationMenuItemConfig[]) => void;
  on: (
    name: "application-menu-clicked",
    handler: (event: unknown) => void,
  ) => void;
}

/**
 * ApplicationMenu API と MenuDeps を受け取り、メニューをインストールする。
 * `rebuild()` を返し、ウィンドウ増減時に呼び直せるようにする。
 *
 * menu.ts を pure に保つため、ApplicationMenu / openFileDialog は呼び出し側
 * (src/bun/index.ts) で electrobun/bun から解決して注入する。
 */
export function installApplicationMenu(
  applicationMenu: ApplicationMenuApi,
  deps: MenuDeps,
): { rebuild: () => void } {
  const rebuild = (): void => {
    applicationMenu.setApplicationMenu(buildApplicationMenu(deps));
  };

  applicationMenu.on("application-menu-clicked", (event: unknown) => {
    const parsed = parseClickEvent(event);
    if (!parsed) return;
    void dispatchMenuAction(parsed, deps).catch((err) => {
      log("error", { message: `dispatchMenuAction failed: ${String(err)}` });
    });
  });

  rebuild();
  return { rebuild };
}

/**
 * 未知の形式の event から最低限 `{ action, data }` を取り出す。
 */
function parseClickEvent(event: unknown): MenuClickEvent | null {
  if (typeof event !== "object" || event === null) return null;
  const record = event as Record<string, unknown>;
  // Electrobun は `{ id, action, data }` 形式で渡す
  const action = record.action;
  if (typeof action !== "string") return null;
  return { action, data: record.data };
}
