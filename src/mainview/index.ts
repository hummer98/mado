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
import {
  MERMAID_ZOOM_DEFAULT,
  MERMAID_ZOOM_MIN,
  MERMAID_ZOOM_MAX,
  clampMermaidZoom,
  nextMermaidZoomIn,
  nextMermaidZoomOut,
  refocusTranslate,
  wheelDeltaToScaleFactor,
} from "../lib/mermaid-zoom";

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
    // attach は try の外。一部の図が throw しても残りの図へ個別ズームを付ける (plan §3.3)。
    // attachMermaidZoom は svg が見つからないノードを早期 return でスキップする。
    for (let i = 0; i < validNodes.length; i++) {
      const node = validNodes[i];
      if (!node) continue;
      attachMermaidZoom(node, contentEl, i, validNodes.length);
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

console.log("[mado] renderer_started");

// trackpad pinch が届いたことを 1 回だけ記録する状態変化ログ（T033）。
// 以後は高頻度 wheel ループを発火させないため、同一セッションで 1 回限り。
let __madoPinchSeen = false;
document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey && !__madoPinchSeen) {
      __madoPinchSeen = true;
      console.log(`[mado] pinch_detected deltaY=${e.deltaY.toFixed(3)}`);
    }
  },
  { passive: true },
);

// --- Mermaid 個別ズーム (T033) ---

/** 1 つの Mermaid に紐づくズーム状態 */
interface MermaidZoomState {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Mermaid `<svg>` に個別の pan/zoom を付与する。
 *
 * - `container` (= `<pre class="mermaid">` もしくは mermaid.run 後の置換要素) の子 svg を
 *   `.mermaid-zoom-wrapper` で包み、overlay に拡大/縮小/リセットボタンを付ける。
 * - wheel + ctrlKey (trackpad pinch) で focal-point zoom。`ctrlKey` なしの wheel は
 *   preventDefault しないのでページスクロールは生きる。
 * - `scale > 1` のとき pointerdown→move でパン可能。threshold 3px 未満はクリック透過。
 *
 * focal-point 計算では T032 の outer CSS `zoom` を `getComputedStyle(contentEl).zoom` で
 * 取得し、`event.clientX/Y - rect` を outerZoom で割って local 座標へ揃える (plan §2.3)。
 */
function attachMermaidZoom(
  container: HTMLElement,
  contentEl: HTMLElement,
  index: number,
  total: number,
): void {
  const svg = container.querySelector<SVGElement>("svg");
  if (!svg) return;

  // Hot Reload / 二重 attach 防止
  if (container.dataset.madoZoomAttached === "true") return;

  // 1. wrap
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-zoom-wrapper";
  svg.before(wrapper);
  wrapper.appendChild(svg);

  // 2. state (クロージャ保持: wrapper ごとに独立)
  const state: MermaidZoomState = {
    scale: MERMAID_ZOOM_DEFAULT,
    tx: 0,
    ty: 0,
  };

  const applyTransform = (): void => {
    svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    if (state.scale > 1) {
      wrapper.classList.add("is-zoomed");
    } else {
      wrapper.classList.remove("is-zoomed");
    }
  };

  /** ボタン操作時だけ短時間 transition を付ける (plan §3.3: pinch 中のドリフト回避) */
  const withTransientTransition = (apply: () => void): void => {
    svg.style.transition = "transform 80ms ease-out";
    apply();
    setTimeout(() => {
      svg.style.transition = "";
    }, 120);
  };

  /** T032 の outer zoom を DOM から取得（plan §2.3: DOM の真実を優先） */
  const getOuterZoom = (): number => {
    const raw = getComputedStyle(contentEl).zoom;
    const parsed = parseFloat(raw || "1");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  /** ボタン・wheel 共通: scale を変更して transform を反映 */
  const setScale = (
    nextScale: number,
    focalX: number,
    focalY: number,
    source: "button" | "wheel" | "pinch",
  ): void => {
    const clamped = clampMermaidZoom(nextScale);
    if (clamped === state.scale) return;
    const { tx, ty } = refocusTranslate(state, clamped, focalX, focalY);
    state.scale = clamped;
    state.tx = tx;
    state.ty = ty;
    applyTransform();
    console.log(
      `[mado] mermaid_zoom_changed index=${index} scale=${state.scale.toFixed(3)} source=${source}`,
    );
  };

  // 3. overlay ボタン
  const controls = document.createElement("div");
  controls.className = "mermaid-zoom-controls";

  const makeButton = (label: string, aria: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    b.title = aria;
    return b;
  };

  const btnIn = makeButton("+", "Mermaid 拡大");
  const btnOut = makeButton("−", "Mermaid 縮小");
  const btnReset = makeButton("⟲", "Mermaid リセット");

  btnIn.addEventListener("click", () => {
    const rect = wrapper.getBoundingClientRect();
    // ボタン操作時は wrapper 中心を focal とする（カーソル位置よりも自然な UX）
    const outerZoom = getOuterZoom();
    const fx = (rect.width / 2) / outerZoom;
    const fy = (rect.height / 2) / outerZoom;
    withTransientTransition(() => {
      setScale(nextMermaidZoomIn(state.scale), fx, fy, "button");
    });
  });
  btnOut.addEventListener("click", () => {
    const rect = wrapper.getBoundingClientRect();
    const outerZoom = getOuterZoom();
    const fx = (rect.width / 2) / outerZoom;
    const fy = (rect.height / 2) / outerZoom;
    withTransientTransition(() => {
      setScale(nextMermaidZoomOut(state.scale), fx, fy, "button");
    });
  });
  btnReset.addEventListener("click", () => {
    withTransientTransition(() => {
      state.scale = MERMAID_ZOOM_DEFAULT;
      state.tx = 0;
      state.ty = 0;
      applyTransform();
      console.log(`[mado] mermaid_zoom_reset index=${index}`);
    });
  });

  controls.appendChild(btnIn);
  controls.appendChild(btnOut);
  controls.appendChild(btnReset);
  wrapper.appendChild(controls);

  // 4. wheel (pinch / Ctrl+scroll)
  wrapper.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      // ctrlKey なしの wheel は通常のページスクロールに任せる (plan §7.4)
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const outerZoom = getOuterZoom();
      const fx = (e.clientX - rect.left) / outerZoom;
      const fy = (e.clientY - rect.top) / outerZoom;
      const factor = wheelDeltaToScaleFactor(e.deltaY);
      const nextScale = Math.min(
        MERMAID_ZOOM_MAX,
        Math.max(MERMAID_ZOOM_MIN, state.scale * factor),
      );
      setScale(nextScale, fx, fy, "pinch");
    },
    { passive: false },
  );

  // 5. pan (pointer)
  let panActive = false;
  let panStartX = 0;
  let panStartY = 0;
  let panLastX = 0;
  let panLastY = 0;
  let panMoved = false; // 3px 閾値越え = クリック透過しない
  const DRAG_THRESHOLD = 3;

  wrapper.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return; // 左クリック以外は無視
    if (state.scale <= 1) return; // scale=1 ではパン無効 (plan §1.1)
    // overlay ボタン上では pan を発動しない
    const target = e.target as Element | null;
    if (target?.closest(".mermaid-zoom-controls")) return;

    panActive = true;
    panMoved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    try {
      wrapper.setPointerCapture(e.pointerId);
    } catch (err) {
      console.error("[mado] setPointerCapture failed:", err);
    }
  });

  wrapper.addEventListener("pointermove", (e: PointerEvent) => {
    if (!panActive) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!panMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return; // threshold 未満: クリック透過のため no-op
    }
    if (!panMoved) {
      panMoved = true;
      wrapper.classList.add("is-panning");
    }
    // movementX/Y は WKWebView で不整合の可能性あり → clientX/Y の差分を優先 (plan §9)
    const stepX = e.clientX - panLastX;
    const stepY = e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    const outerZoom = getOuterZoom();
    state.tx += stepX / outerZoom;
    state.ty += stepY / outerZoom;
    applyTransform();
  });

  const endPan = (e: PointerEvent): void => {
    if (!panActive) return;
    panActive = false;
    wrapper.classList.remove("is-panning");
    try {
      wrapper.releasePointerCapture(e.pointerId);
    } catch {
      // pointerId が既に release 済みのケースは握りつぶす（冪等処理）
    }
    if (panMoved) {
      console.log(
        `[mado] mermaid_zoom_pan_end index=${index} tx=${state.tx.toFixed(1)} ty=${state.ty.toFixed(1)}`,
      );
    }
  };
  wrapper.addEventListener("pointerup", endPan);
  wrapper.addEventListener("pointercancel", endPan);

  container.dataset.madoZoomAttached = "true";
  console.log(`[mado] mermaid_zoom_attached index=${index} total=${total}`);
}
