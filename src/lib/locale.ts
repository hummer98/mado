/**
 * システム言語検出とメニューラベルの i18n サポート。
 *
 * `process.env.LANG` が "ja" で始まる場合は日本語、それ以外は英語を返す。
 * 外部依存なしの純粋関数のみで構成する。
 */

/** サポートする言語コード */
export type Locale = "ja" | "en";

/** メニューラベルのキー一覧 */
export type MenuLabelKey =
  | "app"
  | "file"
  | "edit"
  | "view"
  | "window"
  | "preferences"
  | "open"
  | "openRecent"
  | "clearRecent"
  | "zoomIn"
  | "zoomOut"
  | "actualSize"
  | "wideLayout"
  | "find"
  | "hide"
  | "hideOthers"
  | "showAll"
  | "quit"
  | "minimize"
  | "zoom"
  | "bringAllToFront";

/** 言語ごとのメニューラベル定義 */
const MENU_LABELS: Record<Locale, Record<MenuLabelKey, string>> = {
  en: {
    app: "mado",
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    preferences: "Preferences...",
    open: "Open...",
    openRecent: "Open Recent",
    clearRecent: "Clear Menu",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    actualSize: "Actual Size",
    wideLayout: "Wide Layout",
    find: "Find...",
    hide: "Hide mado",
    hideOthers: "Hide Others",
    showAll: "Show All",
    quit: "Quit mado",
    minimize: "Minimize",
    zoom: "Zoom",
    bringAllToFront: "Bring All to Front",
  },
  ja: {
    app: "mado",
    file: "ファイル",
    edit: "編集",
    view: "表示",
    window: "ウインドウ",
    preferences: "環境設定...",
    open: "開く...",
    openRecent: "最近使った項目",
    clearRecent: "メニューをクリア",
    zoomIn: "拡大",
    zoomOut: "縮小",
    actualSize: "実寸大",
    wideLayout: "ワイド表示",
    find: "検索...",
    hide: "mado を隠す",
    hideOthers: "ほかを隠す",
    showAll: "すべてを表示",
    quit: "mado を終了",
    minimize: "しまう",
    zoom: "ズーム",
    bringAllToFront: "すべてを手前に移動",
  },
};

/**
 * `process.env.LANG` からシステムロケールを検出する。
 * "ja" で始まる値（例: "ja_JP.UTF-8"）なら "ja"、それ以外は "en" を返す。
 */
export function detectLocale(): Locale {
  const lang = process.env.LANG ?? "";
  return lang.startsWith("ja") ? "ja" : "en";
}

/**
 * 指定ロケールの翻訳関数を返す。
 * ロケール省略時は `detectLocale()` で自動検出する。
 */
export function createT(locale: Locale = detectLocale()): (key: MenuLabelKey) => string {
  return (key: MenuLabelKey): string => MENU_LABELS[locale][key];
}
