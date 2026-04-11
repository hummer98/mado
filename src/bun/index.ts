/**
 * メインプロセス（エントリポイント）
 *
 * Electrobun BrowserWindow を作成し、Markdown ファイルをレンダリングする。
 * ログ基盤を最初に初期化してから処理を開始する。
 */

import { BrowserWindow } from "electrobun/bun";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { initLogger, log } from "../lib/logger";

// ログ初期化（最初に行う）
initLogger();
log("app_started", { version: "0.0.1" });

// 起動引数 or 環境変数から Markdown ファイルパスを取得（デフォルト: README.md）
// 環境変数 MADO_FILE: dev 起動時に bun start スクリプトから絶対パスで渡される
const args = process.argv.slice(2);
const mdPath = args[0]
  ? path.resolve(args[0])
  : process.env["MADO_FILE"]
  ? process.env["MADO_FILE"]
  : path.resolve("README.md");

// Markdown ファイルを読み込む
let markdownContent = "";
try {
  markdownContent = readFileSync(mdPath, "utf-8");
  log("file_opened", { path: mdPath });
} catch (err) {
  log("error", { message: `ファイル読み込み失敗: ${String(err)}`, path: mdPath });
  console.error(`[mado] ファイルを開けませんでした: ${mdPath}`);
  // フォールバックコンテンツ
  markdownContent = `# mado\n\nファイルを開けませんでした: \`${mdPath}\`\n`;
}

// BrowserWindow を作成
const win = new BrowserWindow({
  title: `mado — ${path.basename(mdPath)}`,
  frame: { width: 900, height: 700, x: 0, y: 0 },
  url: "views://mainview/index.html",
});

log("webview_state_changed", { state: "creating" });

// DOM 準備完了後に Markdown テキストを注入する
win.webview.on("dom-ready", () => {
  log("webview_state_changed", { state: "dom-ready" });

  // Markdown テキストを JSON エスケープして WebView に渡す
  const escapedContent = JSON.stringify(markdownContent);
  win.webview.executeJavascript(`window.__MADO_RENDER__(${escapedContent})`);
});

// ナビゲーションイベントをログに記録
win.webview.on("did-navigate", () => {
  log("webview_state_changed", { state: "did-navigate" });
});

// 終了処理
process.on("beforeExit", () => {
  log("file_closed", { path: mdPath });
  log("app_exited", { reason: "normal" });
});
