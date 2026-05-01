/**
 * Markdown 内のリンクを mado 用に書き換える
 *
 * - `#anchor`           : そのまま (ブラウザ既定の scroll-into-view)
 * - `http(s):` / `mailto:` 等の絶対 URL : 既定ブラウザで開く
 * - 相対 `.md` (or アンカー付き) : サイドバーに追加して切り替え
 * - その他の相対パス       : 既定アプリで開く（PNG / PDF など）
 *
 * WebView は `views://mainview/...` で読まれているため、
 * 何もしないとリンクが views:// 配下として解決され 404 になる。
 */

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export type LinkAction =
  /** デフォルト動作（ページ内アンカー） */
  | { kind: "anchor" }
  /** 既定ブラウザ等で開く（外部 URL） */
  | { kind: "external"; url: string }
  /** mado にファイルとして開かせる（相対 .md / 相対パス） */
  | { kind: "open-file"; absolutePath: string; fragment: string | null };

/**
 * リンクの href を見て、どう処理すべきかを決定する。
 *
 * @param href - `<a href="...">` の値
 * @param filePath - 現在表示中の Markdown の絶対パス
 */
export function classifyLink(href: string, filePath: string): LinkAction | null {
  if (href === "" ) return null;

  // ページ内アンカーは既定動作で OK
  if (href.startsWith("#")) {
    return { kind: "anchor" };
  }

  // 絶対 URL (https:, mailto:, etc) は外部扱い
  // ただし views:// と file:// は除外（views:// は WebView 内部、file:// は使わない方針）
  if (ABSOLUTE_URL_PATTERN.test(href)) {
    if (href.startsWith("views:") || href.startsWith("file:")) return null;
    return { kind: "external", url: href };
  }

  // ここから相対パス / 絶対パス
  const baseDir = filePath.substring(0, filePath.lastIndexOf("/"));
  let resolved: URL;
  try {
    resolved = new URL(href, `file://${baseDir}/`);
  } catch {
    return null;
  }

  const absolutePath = decodeURIComponent(resolved.pathname);
  const fragment = resolved.hash ? resolved.hash.slice(1) : null;

  return { kind: "open-file", absolutePath, fragment };
}

export interface RewriteLinksHandlers {
  /** mado に新しいファイルを開かせる */
  openFile: (absolutePath: string) => void;
  /** 既定ブラウザ等で URL を開く */
  openExternal: (url: string) => void;
}

/**
 * コンテナ内の全 `<a href>` にクリックハンドラを取り付ける。
 *
 * - 外部 URL は preventDefault → openExternal()
 * - 相対 .md は preventDefault → openFile()
 * - アンカーは既定動作のまま
 */
export function rewriteLinks(
  container: HTMLElement,
  filePath: string,
  handlers: RewriteLinksHandlers,
): void {
  const anchors = container.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (href === null) continue;

    const action = classifyLink(href, filePath);
    if (action === null || action.kind === "anchor") continue;

    // 外部リンクは新規タブを示す視覚補助も付ける
    if (action.kind === "external") {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }

    anchor.addEventListener("click", (ev: MouseEvent) => {
      // 修飾キーは触らない（将来 ⌘+click で「新ウィンドウで開く」等に拡張可能）
      ev.preventDefault();
      if (action.kind === "external") {
        handlers.openExternal(action.url);
      } else {
        // open-file: fragment は現状無視（同ファイル内アンカーは render 後に解決される）
        handlers.openFile(action.absolutePath);
      }
    });
  }
}
