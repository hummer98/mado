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
 * Markdown テキストを DOM に描画する。
 * メインプロセスから window.__MADO_RENDER__(text) として呼ばれる。
 *
 * @param markdownText - レンダリングする Markdown テキスト
 */
async function render(markdownText: string): Promise<void> {
  const contentEl = document.getElementById("content");
  const loadingEl = document.getElementById("loading");

  if (!contentEl) return;

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

  // Mermaid ダイアグラムを SVG に変換
  try {
    await mermaid.run({
      nodes: contentEl.querySelectorAll<HTMLElement>(".mermaid"),
    });
  } catch (err) {
    console.error("[mado] mermaid render error:", err);
    // Mermaid エラーをメインプロセスに通知（window イベント経由）
    window.dispatchEvent(
      new CustomEvent("mado:mermaid-error", { detail: { message: String(err) } })
    );
  }
}

// --- グローバル関数として公開 ---

// window に型を付与
declare global {
  interface Window {
    __MADO_RENDER__: (markdownText: string) => void;
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

// DOM が既に準備完了している場合に備えて renderer_started ログを記録
console.log("[mado] renderer_started");
