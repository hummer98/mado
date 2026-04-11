/**
 * WebView 側レンダリングエンジン
 *
 * Markdown テキストを GFM + Mermaid + highlight.js でレンダリングする。
 * メインプロセスからは window.__MADO_RENDER__(markdownText) で呼び出される。
 */

import { marked, type MarkedExtension } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import hljs from "highlight.js";
import mermaid from "mermaid";

// --- marked の設定 ---

// highlight.js を使ったカスタム renderer（コードブロックをハイライト）
const hljsExtension: MarkedExtension = {
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      // Mermaid ダイアグラムは <pre class="mermaid"> として出力し、後で mermaid.run() が変換する
      if (lang === "mermaid") {
        return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
      }

      // highlight.js でシンタックスハイライト
      if (lang && hljs.getLanguage(lang)) {
        const highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted.value}</code></pre>`;
      }

      // 言語不明の場合は自動検出
      const highlighted = hljs.highlightAuto(text);
      return `<pre><code class="hljs">${highlighted.value}</code></pre>`;
    },
  },
};

// marked に拡張を適用
marked.use(gfmHeadingId());
marked.use(hljsExtension);
marked.use({ gfm: true });

// --- Mermaid の初期化 ---

// OS のカラースキームに合わせてテーマを選択
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

mermaid.initialize({
  startOnLoad: false, // 手動で run() を呼ぶ
  theme: prefersDark ? "dark" : "default",
  securityLevel: "loose", // クリックイベント等を許可
});

// --- ダークモードに合わせた highlight.js テーマ切り替え ---

if (prefersDark) {
  const lightTheme = document.getElementById("hljs-theme-light") as HTMLLinkElement | null;
  const darkTheme = document.getElementById("hljs-theme-dark") as HTMLLinkElement | null;
  if (lightTheme) lightTheme.disabled = true;
  if (darkTheme) darkTheme.disabled = false;
}

// --- レンダリングパイプライン ---

/**
 * HTML エスケープ（XSS 対策）
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Mermaid エラー表示用の罫線ボックステキストを生成する。
 */
function buildErrorBoxText(
  index: number,
  message: string,
  code: string
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

/**
 * Markdown テキストを DOM に描画する。
 * メインプロセスから window.__MADO_RENDER__(text) として呼ばれる。
 *
 * @param markdownText - レンダリングする Markdown テキスト
 */
async function render(markdownText: string): Promise<void> {
  const contentEl = document.getElementById("content");
  const loadingEl = document.getElementById("loading");

  if (!contentEl) return;

  // 初回レンダリング（ローディング状態からの遷移）ではスクロール復元しない
  const isInitialRender =
    loadingEl !== null && loadingEl.style.display !== "none";
  const savedScrollY = isInitialRender ? 0 : window.scrollY;

  // ローディング非表示
  if (loadingEl) loadingEl.style.display = "none";
  contentEl.style.display = "block";

  // marked で Markdown → HTML に変換
  let html: string;
  try {
    const result = marked(markdownText);
    html = result instanceof Promise ? await result : result;
  } catch (err) {
    console.error("[mado] marked parse error:", err);
    contentEl.innerHTML = `<p style="color:red">Markdown のパースに失敗しました: ${String(err)}</p>`;
    return;
  }

  // DOM に挿入
  contentEl.innerHTML = html;

  // Mermaid ダイアグラムを個別に検証し、エラーがあればインライン表示する
  const mermaidNodes = contentEl.querySelectorAll<HTMLElement>(".mermaid");
  const validNodes: HTMLElement[] = [];
  const errors: Array<{ index: number; message: string; code: string }> = [];

  for (let i = 0; i < mermaidNodes.length; i++) {
    const node = mermaidNodes[i];
    const code = node.textContent ?? "";

    try {
      await mermaid.parse(code);
      validNodes.push(node);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ index: i, message, code });

      // エラー表示用の DOM に置き換え
      const errorPre = document.createElement("pre");
      errorPre.className = "mermaid-error";
      errorPre.textContent = buildErrorBoxText(i, message, code);
      node.replaceWith(errorPre);

      console.error(`[mado] mermaid parse error in diagram #${i + 1}:`, message);
    }
  }

  // parse に成功したノードのみ mermaid.run() に渡す
  if (validNodes.length > 0) {
    try {
      await mermaid.run({ nodes: validNodes });
    } catch (err) {
      console.error("[mado] mermaid render error:", err);
    }
  }

  // エラー情報をメインプロセスに通知
  if (errors.length > 0 && "__electrobunSendToHost" in window) {
    const sendToHost = window.__electrobunSendToHost;
    if (typeof sendToHost === "function") {
      sendToHost({
        type: "mermaid-errors",
        errors,
      });
    }
  }

  // Hot Reload 時のスクロール位置を復元（初回レンダリングでは復元しない）
  window.scrollTo(0, savedScrollY);
}

// --- WebSocket クライアント ---

/** WebSocket からのサーバーメッセージ型 */
type WsServerMessage =
  | { type: "render"; content: string; filePath: string }
  | { type: "file-switched"; content: string; filePath: string };

/** WsServerMessage の型ガード */
function isWsServerMessage(data: unknown): data is WsServerMessage {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    (obj.type === "render" || obj.type === "file-switched") &&
    typeof obj.content === "string" &&
    typeof obj.filePath === "string"
  );
}

/**
 * WebSocket クライアントを起動し、Hot Reload メッセージを待機する。
 * 接続が切れた場合は指数バックオフで再接続を試みる。
 *
 * @param port - Bun 側 WS サーバーのポート番号
 */
function connectWebSocket(port: number): void {
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 500;

  function connect(): void {
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.onopen = () => {
      retryCount = 0;
      console.log("[mado] WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw: unknown = JSON.parse(event.data as string);
        if (!isWsServerMessage(raw)) return;

        // render / file-switched はどちらも同じレンダリングパイプラインを使う
        render(raw.content).catch((err: unknown) => {
          console.error("[mado] ws render error:", err);
        });
      } catch (err) {
        console.error("[mado] ws message parse error:", err);
      }
    };

    ws.onclose = () => {
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
      // onclose が続けて呼ばれるので再接続はそちらで行う
    };
  }

  connect();
}

// --- グローバル関数として公開 ---

// window に型を付与
declare global {
  interface Window {
    __MADO_RENDER__: (markdownText: string) => void;
    __MADO_WS_CONNECT__: (port: number) => void;
    /** Electrobun のプリロードが提供する host-message 送信関数 */
    __electrobunSendToHost?: (data: unknown) => void;
  }
}

/**
 * メインプロセスから呼ばれるエントリポイント。
 * executeJavascript(`window.__MADO_RENDER__(${JSON.stringify(text)})`) で呼び出す。
 */
window.__MADO_RENDER__ = (markdownText: string): void => {
  render(markdownText).catch((err: unknown) => {
    console.error("[mado] render error:", err);
  });
};

// 重複接続ガード: dom-ready が複数回発火しても1回だけ接続する
let wsConnected = false;

/**
 * WebSocket クライアントを起動する。
 * executeJavascript(`window.__MADO_WS_CONNECT__(port)`) で呼び出す。
 * dom-ready が複数回発火しても1回しか接続しない。
 */
window.__MADO_WS_CONNECT__ = (port: number): void => {
  if (wsConnected) return;
  wsConnected = true;
  connectWebSocket(port);
};

// DOM が既に準備完了している場合に備えて renderer_started ログを記録
console.log("[mado] renderer_started");
