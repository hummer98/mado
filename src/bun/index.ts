/**
 * メインプロセス（エントリポイント）
 *
 * CLI 引数をパースし、git root 単位でウィンドウを管理する。
 * 同じ git root のプロセスが既に起動中なら IPC でファイルパスを送信して終了する。
 * 初回起動なら BrowserWindow を作成し、IPC サーバーを起動する。
 */

import { BrowserWindow } from "electrobun/bun";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { parseCliArgs } from "../lib/cli";
import { findGitRoot } from "../lib/git-root";
import { getSocketPath } from "../lib/socket-path";
import { sendFileToExistingProcess } from "../lib/ipc-client";
import { startIpcServer, stopIpcServer } from "../lib/ipc-server";
import { initLogger, log } from "../lib/logger";

/**
 * Markdown ファイルを読み込む。失敗時はフォールバックコンテンツを返す。
 */
function loadMarkdownFile(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    log("file_opened", { path: filePath });
    return content;
  } catch (err) {
    log("error", { message: `ファイル読み込み失敗: ${String(err)}`, path: filePath });
    console.error(`[mado] ファイルを開けませんでした: ${filePath}`);
    return `# mado\n\nファイルを開けませんでした: \`${filePath}\`\n`;
  }
}

async function main(): Promise<void> {
  // ログ初期化（最初に行う）
  initLogger();
  log("app_started", { version: "0.0.1" });

  // 1. CLI 引数パース
  const result = parseCliArgs(process.argv);
  if (!result.ok) {
    console.error(`[mado] エラー: ${result.error}`);
    process.exit(1);
  }
  const { filePath, warnings } = result;
  warnings.forEach((w) => console.warn(`[mado] ${w}`));

  // 2. git root 検出（git 外の場合はファイルの親ディレクトリを使用）
  const gitRoot = findGitRoot(filePath) ?? path.dirname(filePath);
  log("git_root_detected", { gitRoot, filePath });

  // 3. ソケットパス算出
  const socketPath = getSocketPath(gitRoot);

  // 4. 既存プロセスへの委譲を試みる
  const delegated = await sendFileToExistingProcess(socketPath, filePath);
  if (delegated) {
    log("file_delegated", { path: filePath, gitRoot });
    console.log(
      `[mado] 既存ウィンドウにファイルを送信しました: ${path.basename(filePath)}`
    );
    process.exit(0);
  }

  // 5. ファイル読み込み
  let markdownContent = loadMarkdownFile(filePath);
  let currentFilePath = filePath;

  // 6. BrowserWindow を作成
  const win = new BrowserWindow({
    title: `mado — ${path.basename(filePath)}`,
    frame: { width: 900, height: 700, x: 0, y: 0 },
    url: "views://mainview/index.html",
  });
  log("webview_state_changed", { state: "creating" });

  // 7. DOM 準備完了後に Markdown テキストを注入
  win.webview.on("dom-ready", () => {
    log("webview_state_changed", { state: "dom-ready" });
    const escapedContent = JSON.stringify(markdownContent);
    win.webview.executeJavascript(
      `window.__MADO_RENDER__(${escapedContent})`
    );
  });

  win.webview.on("did-navigate", () => {
    log("webview_state_changed", { state: "did-navigate" });
  });

  // 8. IPC サーバー起動（2回目以降の起動からファイルパスを受信）
  const ipcServer = startIpcServer(socketPath, (newFilePath) => {
    try {
      const newContent = readFileSync(newFilePath, "utf-8");
      const previousPath = currentFilePath;
      currentFilePath = newFilePath;

      log("file_switched", { from: previousPath, to: newFilePath });

      // WebView の内容を更新
      const escaped = JSON.stringify(newContent);
      win.webview.executeJavascript(`window.__MADO_RENDER__(${escaped})`);

      console.log(
        `[mado] ファイルを切り替えました: ${path.basename(newFilePath)}`
      );
    } catch (err) {
      log("error", {
        message: `ファイル切り替え失敗: ${String(err)}`,
        path: newFilePath,
      });
      console.error(
        `[mado] ファイルを切り替えられませんでした: ${newFilePath}`
      );
    }
  });

  // 9. 終了処理
  process.on("beforeExit", () => {
    stopIpcServer(ipcServer, socketPath);
    log("file_closed", { path: currentFilePath });
    log("app_exited", { reason: "normal" });
  });
}

main();
