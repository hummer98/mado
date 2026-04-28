/**
 * WebView 側レンダリングエンジン
 *
 * Markdown テキストを GFM + Mermaid + highlight.js でレンダリングする。
 * Bun 側からは WebSocket の state メッセージで content + ファイルリストを受け取る。
 */

import { marked, type MarkedExtension } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import hljs from "highlight.js";
import mermaid from "mermaid";
import { rewriteImageUrls } from "./rewrite-image-urls";
import { clampZoom, nextZoomIn, nextZoomOut, ZOOM_DEFAULT } from "../lib/zoom-state";

// --- marked の設定 ---

const hljsExtension: MarkedExtension = {
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      // Mermaid ダイアグラムは <pre class="mermaid"> として出力し、後で mermaid.run() が変換する
      if (lang === "mermaid") {
        return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
      }

      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted.value}</code></pre>`;
      }

      const highlighted = hljs.highlightAuto(text);
      return `<pre><code class="hljs">${highlighted.value}</code></pre>`;
    },
  },
};

marked.use(gfmHeadingId());
marked.use(hljsExtension);
marked.use({ gfm: true });

// --- Mermaid の初期化 ---

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

mermaid.initialize({
  startOnLoad: false,
  theme: prefersDark ? "dark" : "default",
  securityLevel: "loose",
});

// --- ダークモードに合わせた highlight.js テーマ切り替え ---

if (prefersDark) {
  const lightTheme = document.getElementById("hljs-theme-light") as HTMLLinkElement | null;
  const darkTheme = document.getElementById("hljs-theme-dark") as HTMLLinkElement | null;
  if (lightTheme) lightTheme.disabled = true;
  if (darkTheme) darkTheme.disabled = false;
}

// --- レンダリングパイプライン ---

/** HTML エスケープ（XSS 対策） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Mermaid エラー表示用の罫線ボックステキストを生成する */
function buildErrorBoxText(
  index: number,
  message: string,
  code: string,
): string {
  const headerText = `Mermaid Error (diagram #${index + 1})`;
  const contentLines: string[] = [message];

  if (code.length > 0) {
    contentLines.push("Source:");
    const codeLines = code.split("\n").slice(0, 3);
    for (const line of codeLines) {
      contentLines.push(`  ${line}`);
    }
  }

  const allLines = [headerText, ...contentLines];
  const maxContentWidth = Math.max(...allLines.map((l) => l.length));
  const innerWidth = maxContentWidth + 2;

  const top = `┌─ ${headerText} ${"─".repeat(Math.max(0, innerWidth - headerText.length - 2))}─┐`;
  const bottom = `└─${"─".repeat(innerWidth)}─┘`;
  const body = contentLines
    .map((l) => `│ ${l.padEnd(innerWidth)} │`)
    .join("\n");

  return `${top}\n${body}\n${bottom}`;
}

/** WS サーバーのポート番号（画像 URL 書き換えに使用） */
let wsPort: number | null = null;

/** 直前にレンダリングしたファイルパス（同一なら scroll 維持、別なら top に戻す） */
let lastRenderedFilePath: string | null = null;

/**
 * Markdown テキストを DOM に描画する。
 *
 * @param markdownText - レンダリングする Markdown テキスト
 * @param filePath - 現在のファイルパス（スクロール維持判定用）
 */
async function render(markdownText: string, filePath: string): Promise<void> {
  const contentEl = document.getElementById("content");
  const loadingEl = document.getElementById("loading");
  const emptyEl = document.getElementById("empty-state");
  const mainEl = document.getElementById("main");

  if (!contentEl) return;

  // 同じファイルなら scroll 維持、別ファイルへ切替なら 0 にリセット
  const isSameFile =
    lastRenderedFilePath !== null && lastRenderedFilePath === filePath;
  const savedScrollY = isSameFile && mainEl ? mainEl.scrollTop : 0;

  if (loadingEl) loadingEl.style.display = "none";
  if (emptyEl) emptyEl.style.display = "none";
  contentEl.style.display = "block";

  let html: string;
  try {
    const result = marked(markdownText);
    html = result instanceof Promise ? await result : result;
  } catch (err) {
    console.error("[mado] marked parse error:", err);
    contentEl.innerHTML = `<p style="color:red">Markdown のパースに失敗しました: ${String(err)}</p>`;
    return;
  }

  contentEl.innerHTML = html;

  if (wsPort !== null && filePath) {
    rewriteImageUrls(contentEl, filePath, wsPort);
  }

  const mermaidNodes = contentEl.querySelectorAll<HTMLElement>(".mermaid");
  const validNodes: HTMLElement[] = [];
  const errors: Array<{ index: number; message: string; code: string }> = [];

  for (let i = 0; i < mermaidNodes.length; i++) {
    const node = mermaidNodes[i];
    if (!node) continue;
    const code = node.textContent ?? "";

    try {
      await mermaid.parse(code);
      validNodes.push(node);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ index: i, message, code });

      const errorPre = document.createElement("pre");
      errorPre.className = "mermaid-error";
      errorPre.textContent = buildErrorBoxText(i, message, code);
      node.replaceWith(errorPre);

      console.error(`[mado] mermaid parse error in diagram #${i + 1}:`, message);
    }
  }

  if (validNodes.length > 0) {
    try {
      await mermaid.run({ nodes: validNodes });
    } catch (err) {
      console.error("[mado] mermaid render error:", err);
    }
  }

  if (errors.length > 0 && "__electrobunSendToHost" in window) {
    const sendToHost = window.__electrobunSendToHost;
    if (typeof sendToHost === "function") {
      sendToHost({
        type: "mermaid-errors",
        errors,
      });
    }
  }

  if (mainEl) {
    mainEl.scrollTop = savedScrollY;
  }

  // Hot Reload / ファイル切替時に inline zoom が失われていた場合のフェイルセーフ (T032)。
  // render() は .markdown-body の innerHTML を差し替えるが要素自体は維持するため
  // 通常 zoom style は残る。念のため currentZoom が DEFAULT 以外なら再適用する。
  if (currentZoom !== ZOOM_DEFAULT) {
    contentEl.style.zoom = String(currentZoom);
  }

  // Wide Layout (T042): 同様のフェイルセーフ。enabled=true 時のみ inline 復元。
  if (wideLayoutEnabled) {
    contentEl.style.maxWidth = "none";
  }

  lastRenderedFilePath = filePath;
}

// --- サイドバー描画 ---

interface FileListEntry {
  absolutePath: string;
  relativePath: string;
}

interface ServerStateMessage {
  type: "state";
  files: FileListEntry[];
  activeIndex: number;
  content: string;
  filePath: string;
}

let wsRef: WebSocket | null = null;

/**
 * サイドバーのファイルリストを描画する。
 */
function renderSidebar(files: FileListEntry[], activeIndex: number): void {
  const list = document.getElementById("file-list");
  if (!list) return;

  list.innerHTML = "";
  files.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.className = idx === activeIndex ? "entry active" : "entry";
    li.dataset.absolutePath = entry.absolutePath;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "entry-label";
    label.textContent = entry.relativePath;
    label.title = entry.absolutePath;
    label.addEventListener("click", () => {
      sendClientMessage({ type: "switch-file", absolutePath: entry.absolutePath });
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "entry-close";
    close.textContent = "✗";
    close.title = "リストから削除";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      sendClientMessage({ type: "remove-file", absolutePath: entry.absolutePath });
    });

    // 右クリック（またはトラックパッド 2 本指タップ）でネイティブメニュー表示を要求。
    // preventDefault しないと WebKit の既定メニュー（コピー / 検索 / リロード…）が出る。
    li.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      sendToHost({
        type: "show-entry-context-menu",
        absolutePath: entry.absolutePath,
        relativePath: entry.relativePath,
      });
    });

    li.appendChild(label);
    li.appendChild(close);
    list.appendChild(li);
  });
}

/**
 * host (Bun 側) にメッセージを送信する。
 * Electrobun プリロードが `window.__electrobunSendToHost` を注入する前に呼ばれた場合
 * や送信に失敗した場合は警告ログのみ出して握りつぶさない。
 */
function sendToHost(data: unknown): void {
  if (typeof window.__electrobunSendToHost !== "function") {
    console.warn("[mado] __electrobunSendToHost not available");
    return;
  }
  try {
    window.__electrobunSendToHost(data);
  } catch (err) {
    console.error("[mado] sendToHost failed:", err);
  }
}

/** 空状態の表示を切り替える */
function updateEmptyState(isEmpty: boolean): void {
  const emptyEl = document.getElementById("empty-state");
  const contentEl = document.getElementById("content");
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "none";
  if (isEmpty) {
    if (emptyEl) emptyEl.style.display = "flex";
    if (contentEl) {
      contentEl.style.display = "none";
      contentEl.innerHTML = "";
    }
    lastRenderedFilePath = null;
  } else {
    if (emptyEl) emptyEl.style.display = "none";
  }
}

/** クライアント→サーバーメッセージ型 */
type ClientMessage =
  | { type: "ready" }
  | { type: "switch-file"; absolutePath: string }
  | { type: "remove-file"; absolutePath: string };

function sendClientMessage(msg: ClientMessage): void {
  if (!wsRef || wsRef.readyState !== WebSocket.OPEN) {
    console.warn("[mado] ws not ready, dropping message:", msg);
    return;
  }
  try {
    wsRef.send(JSON.stringify(msg));
  } catch (err) {
    console.error("[mado] ws send failed:", err);
  }
}

// --- WebSocket クライアント ---

/** state メッセージの型ガード */
function isStateMessage(data: unknown): data is ServerStateMessage {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.type !== "state") return false;
  if (!Array.isArray(obj.files)) return false;
  if (typeof obj.activeIndex !== "number") return false;
  if (typeof obj.content !== "string") return false;
  if (typeof obj.filePath !== "string") return false;
  for (const f of obj.files) {
    if (typeof f !== "object" || f === null) return false;
    const fe = f as Record<string, unknown>;
    if (typeof fe.absolutePath !== "string") return false;
    if (typeof fe.relativePath !== "string") return false;
  }
  return true;
}

/**
 * WebSocket クライアントを起動し、state メッセージを処理する。
 * 接続が切れた場合は指数バックオフで再接続を試みる。
 */
function connectWebSocket(port: number): void {
  wsPort = port;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 500;

  function connect(): void {
    const ws = new WebSocket(`ws://localhost:${port}`);
    wsRef = ws;

    ws.onopen = () => {
      retryCount = 0;
      console.log("[mado] WebSocket connected");
      // 初回 / 再接続時に現状を取得するため ready を送る
      try {
        ws.send(JSON.stringify({ type: "ready" }));
      } catch (err) {
        console.error("[mado] ready send failed:", err);
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw: unknown = JSON.parse(event.data as string);
        if (!isStateMessage(raw)) return;

        renderSidebar(raw.files, raw.activeIndex);

        if (raw.files.length === 0) {
          updateEmptyState(true);
          return;
        }

        updateEmptyState(false);
        render(raw.content, raw.filePath).catch((err: unknown) => {
          console.error("[mado] render error:", err);
        });
      } catch (err) {
        console.error("[mado] ws message parse error:", err);
      }
    };

    ws.onclose = () => {
      wsRef = null;
      if (retryCount >= MAX_RETRIES) {
        console.warn("[mado] WebSocket: max retries exceeded, giving up");
        return;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
      retryCount++;
      console.log(`[mado] WebSocket closed, retrying in ${delay}ms (${retryCount}/${MAX_RETRIES})`);
      setTimeout(connect, delay);
    };

    ws.onerror = (event: Event) => {
      console.error("[mado] WebSocket error:", event);
    };
  }

  connect();
}

// --- サイドバー アコーディオン動作 ---

/** トリガー元 (ログ目的) */
type ToggleSource = "keydown" | "menu" | "api";

/** サイドバーの開閉状態 (初期値は開) */
let sidebarOpen = true;

/**
 * サイドバーの開閉をトグルする。
 *
 * `#app` の `data-sidebar` 属性と `#sidebar` の `aria-hidden` を同期させ、
 * 状態遷移イベントを WebView console にログする。
 */
function toggleSidebar(source: ToggleSource): void {
  const appEl = document.getElementById("app");
  const sidebarEl = document.getElementById("sidebar");
  if (!appEl || !sidebarEl) return;

  sidebarOpen = !sidebarOpen;
  const nextState = sidebarOpen ? "open" : "closed";
  appEl.setAttribute("data-sidebar", nextState);
  sidebarEl.setAttribute("aria-hidden", sidebarOpen ? "false" : "true");

  const event = sidebarOpen ? "sidebar_opened" : "sidebar_closed";
  console.log(`[mado] ${event} source=${source}`);
}

// WebView 内キーボードショートカット: ⌘⌥S (メニュー未実装環境での補助)
document.addEventListener("keydown", (ev: KeyboardEvent) => {
  if (ev.metaKey && ev.altKey && ev.code === "KeyS") {
    ev.preventDefault();
    toggleSidebar("keydown");
  }
});

// --- グローバル関数として公開 ---

declare global {
  interface Window {
    __MADO_WS_CONNECT__: (port: number) => void;
    /** View メニュー (⌘⌥S) から executeJavascript で呼び出される toggle 関数 */
    __MADO_TOGGLE_SIDEBAR__: () => void;
    /** View > 拡大 (⌘+) から executeJavascript で呼び出される (T032) */
    __MADO_ZOOM_IN__: () => void;
    /** View > 縮小 (⌘-) から executeJavascript で呼び出される (T032) */
    __MADO_ZOOM_OUT__: () => void;
    /** View > 実寸 (⌘0) から executeJavascript で呼び出される (T032) */
    __MADO_ZOOM_RESET__: () => void;
    /** View > Wide Layout から executeJavascript で呼び出される (T042) */
    __MADO_SET_WIDE_LAYOUT__: (enabled: boolean) => void;
    /** Electrobun のプリロードが提供する host-message 送信関数 */
    __electrobunSendToHost?: (data: unknown) => void;
  }
}

// 重複接続ガード
let wsConnected = false;

window.__MADO_WS_CONNECT__ = (port: number): void => {
  if (wsConnected) return;
  wsConnected = true;
  connectWebSocket(port);
};

window.__MADO_TOGGLE_SIDEBAR__ = (): void => {
  toggleSidebar("menu");
};

// --- ズーム制御 (T032) ---
//
// 計画通り本文コンテナ (`#content` = `article.markdown-body`) の CSS `zoom` を
// 書き換えることで、サイドバー非影響・Mermaid/コードブロック込みの一括ズームを実現する。
// 状態はモジュールスコープの currentZoom に保持し、Hot Reload で .markdown-body の
// innerHTML が差し替わっても要素自体は残るため inline style は維持される想定。
//
// DOM 不在（welcome 画面で content が未表示）でも currentZoom は更新される。
// これは次に .markdown-body が表示された時、CSS デフォルト zoom:1 と state が
// 一致する限り問題にならない（ZOOM_DEFAULT は 1.0）。別倍率で welcome から
// 抜けた場合のフェイルセーフとして、render() 終端で inline style を再適用する。
let currentZoom: number = ZOOM_DEFAULT;

function applyZoom(next: number): void {
  const clamped = clampZoom(next);
  if (clamped === currentZoom) return;
  currentZoom = clamped;
  // `#content` (= article.markdown-body) を直接取得する。
  // id の方が「本文コンテナ」という意図に近く、Welcome 時も要素自体は存在する。
  const el = document.getElementById("content");
  if (!el) return;
  el.style.zoom = String(currentZoom);
  console.log(`[mado] zoom_changed level=${currentZoom}`);
}

window.__MADO_ZOOM_IN__ = (): void => {
  applyZoom(nextZoomIn(currentZoom));
};
window.__MADO_ZOOM_OUT__ = (): void => {
  applyZoom(nextZoomOut(currentZoom));
};
window.__MADO_ZOOM_RESET__ = (): void => {
  applyZoom(ZOOM_DEFAULT);
};

// --- Wide Layout 制御 (T042) ---
//
// `.markdown-body` (= #content) の inline style.maxWidth を切り替える。
// enabled=true → 'none' でウィンドウ幅にフィット
// enabled=false → '' で CSS 既定値 (980px) に復元
//
// 状態をモジュール変数に保持するのは render() 後のフェイルセーフ目的（zoom と同パターン）。
let wideLayoutEnabled = false;

function applyWideLayout(enabled: boolean): void {
  wideLayoutEnabled = enabled;
  const el = document.getElementById("content");
  if (!el) return;
  el.style.maxWidth = enabled ? "none" : "";
  console.log(`[mado] wide_layout_changed enabled=${enabled}`);
}

window.__MADO_SET_WIDE_LAYOUT__ = (enabled: boolean): void => {
  applyWideLayout(Boolean(enabled));
};

console.log("[mado] renderer_started");
