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
import { startFileWatcher } from "../lib/file-watcher";
import type { FileWatcher } from "../lib/file-watcher";
import { initLogger, log } from "../lib/logger";
import { formatMermaidError } from "../lib/mermaid-error";
import type { MermaidErrorInfo } from "../lib/mermaid-error";

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

/**
 * host-message イベントから Mermaid エラー情報を処理する。
 * WebView 側の __electrobunSendToHost() から送信されたデータを受信する。
 */
function handleMermaidErrorEvent(event: unknown): void {
  try {
    // イベントデータの構造を検証
    if (
      typeof event !== "object" ||
      event === null ||
      !("data" in event) ||
      typeof (event as Record<string, unknown>).data !== "object"
    ) {
      return;
    }

    const data = (event as Record<string, unknown>).data as Record<string, unknown>;

    // Mermaid エラーイベントかどうか確認
    if (data.type !== "mermaid-errors" || !Array.isArray(data.errors)) {
      return;
    }

    for (const error of data.errors) {
      if (
        typeof error === "object" &&
        error !== null &&
        typeof (error as Record<string, unknown>).index === "number" &&
        typeof (error as Record<string, unknown>).message === "string"
      ) {
        const errorInfo: MermaidErrorInfo = {
          index: (error as Record<string, unknown>).index as number,
          message: (error as Record<string, unknown>).message as string,
          code: typeof (error as Record<string, unknown>).code === "string"
            ? (error as Record<string, unknown>).code as string
            : "",
        };
        console.log(formatMermaidError(errorInfo));
        log("mermaid_error", {
          diagram: errorInfo.index + 1,
          message: errorInfo.message,
        });
      }
    }
  } catch (err) {
    log("error", { message: `mermaid error event handling failed: ${String(err)}` });
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
  let watcher: FileWatcher | null = null;

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

    // Hot Reload: ファイル監視開始
    watcher = startFileWatcher(currentFilePath, (changedPath) => {
      try {
        const newContent = readFileSync(changedPath, "utf-8");
        const escaped = JSON.stringify(newContent);
        win.webview.executeJavascript(`window.__MADO_RENDER__(${escaped})`);
        log("hot_reload_triggered", { path: changedPath });
      } catch (err) {
        log("error", { message: `hot reload read failed: ${String(err)}`, path: changedPath });
      }
    });
  });

  win.webview.on("did-navigate", () => {
    log("webview_state_changed", { state: "did-navigate" });
  });

  // 8. Mermaid エラー通知の受信（host-message イベント）
  // 注意: "host-message" は BrowserView.on() の型定義に含まれないため、
  // BrowserWindow.on() を使用する（string 型を受け付ける）
  win.on("host-message", (event: unknown) => {
    handleMermaidErrorEvent(event);
  });

  // 9. IPC サーバー起動（2回目以降の起動からファイルパスを受信）
  const ipcServer = startIpcServer(socketPath, (newFilePath) => {
    try {
      const newContent = readFileSync(newFilePath, "utf-8");
      const previousPath = currentFilePath;
      currentFilePath = newFilePath;

      log("file_switched", { from: previousPath, to: newFilePath });

      // WebView の内容を更新
      const escaped = JSON.stringify(newContent);
      win.webview.executeJavascript(`window.__MADO_RENDER__(${escaped})`);

      // Hot Reload: 監視対象を新しいファイルに切り替え
      if (watcher) {
        watcher.switchFile(newFilePath);
      }

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

  // 10. 終了処理
  process.on("beforeExit", () => {
    if (watcher) {
      watcher.stop();
    }
    stopIpcServer(ipcServer, socketPath);
    log("file_closed", { path: currentFilePath });
    log("app_exited", { reason: "normal" });
  });
}

main();
