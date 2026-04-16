/**
 * 画像の相対パスを localhost HTTP URL に書き換える
 *
 * WebView は views:// プロトコルで読み込まれるため、
 * Markdown 内の相対パス画像がファイルシステムに到達できない。
 * WS サーバーの /_local/ エンドポイント経由で配信する。
 */

const SKIP_PATTERN = /^(https?:|data:|blob:|#)/;

/**
 * 画像 src を localhost の /_local/ URL に解決する。
 * スキップすべき URL（外部・data・blob・フラグメント）の場合は null を返す。
 */
export function resolveLocalImageUrl(
  src: string,
  filePath: string,
  port: number,
): string | null {
  if (SKIP_PATTERN.test(src)) return null;

  const baseDir = filePath.substring(0, filePath.lastIndexOf("/"));
  const resolved = new URL(src, `file://${baseDir}/`).pathname;
  return `http://localhost:${port}/_local${resolved}`;
}

/**
 * コンテナ内の img 要素の相対パスを localhost URL に書き換える。
 */
export function rewriteImageUrls(
  container: HTMLElement,
  filePath: string,
  port: number,
): void {
  const imgs = container.querySelectorAll<HTMLImageElement>("img[src]");
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src) continue;
    const rewritten = resolveLocalImageUrl(src, filePath, port);
    if (rewritten) {
      img.src = rewritten;
    }
  }
}
