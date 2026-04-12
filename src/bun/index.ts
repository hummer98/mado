/**
 * メインプロセス（エントリポイント）
 *
 * CLI 引数をパースし、git root 単位でウィンドウを管理する。
 * 同じ git root のプロセスが既に起動中なら IPC でファイルパスを送信して終了する。
 * 初回起動なら BrowserWindow を作成し、IPC サーバー + WS サーバーを起動する。
 *
 * ファイルリストの状態は本プロセスで一元管理し、WebView 側は state メッセージを受け取って描画するだけ。
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
import { startWsServer } from "../lib/ws-server";
import type { WsServer, ClientMessage } from "../lib/ws-server";
import { formatMermaidError } from "../lib/mermaid-error";
import type { MermaidErrorInfo } from "../lib/mermaid-error";
import {
  activeEntry,
  addFile,
  createEmptyState,
  removeByPath,
  setActiveByPath,
  toRelative,
} from "../lib/file-list";
import type { FileListEntry, FileListState } from "../lib/file-list";

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
    if (
      typeof event !== "object" ||
      event === null ||
      !("data" in event) ||
      typeof (event as Record<string, unknown>).data !== "object"
    ) {
      return;
    }

    const data = (event as Record<string, unknown>).data as Record<string, unknown>;

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
  // ログ初期化
  initLogger();
  log("app_started", { version: "0.0.1" });

  // 1. CLI 引数パース
  const result = parseCliArgs(process.argv);
  if (!result.ok) {
    console.error(`[mado] エラー: ${result.error}`);
    process.exit(1);
  }
  const { filePath, source, warnings } = result;
  log("cli_parsed", { source, path: filePath });
  warnings.forEach((w) => console.warn(`[mado] ${w}`));

  // 2. git root 検出
  const gitRoot = findGitRoot(filePath) ?? path.dirname(filePath);
  log("git_root_detected", { gitRoot, filePath });

  // 3. ソケットパス算出
  const socketPath = getSocketPath(gitRoot);

  // 4. 既存プロセスへの委譲を試みる
  const delegated = await sendFileToExistingProcess(socketPath, filePath);
  if (delegated) {
    log("file_delegated", { path: filePath, gitRoot });
    console.log(
      `[mado] 既存ウィンドウにファイルを送信しました: ${path.basename(filePath)}`,
    );
    process.exit(0);
  }

  // 5. ファイルリスト状態の初期化（初期ファイルを 1 件追加）
  let state: FileListState = createEmptyState();
  let watcher: FileWatcher | null = null;
  let wsServer: WsServer | null = null;

  /** 絶対パスから FileListEntry を構築する */
  function buildEntry(absPath: string): FileListEntry {
    const abs = path.resolve(absPath);
    const rel = toRelative(abs, gitRoot);
    if (rel === path.basename(abs) && !abs.startsWith(gitRoot + path.sep) && abs !== gitRoot) {
      log("file_outside_git_root", { path: abs });
    }
    return { absolutePath: abs, relativePath: rel };
  }

  /**
   * アクティブファイルの内容を読み込んで返す。アクティブが無ければ空文字。
   */
  function readActiveContent(): { content: string; filePath: string } {
    const entry = activeEntry(state);
    if (!entry) return { content: "", filePath: "" };
    try {
      return { content: readFileSync(entry.absolutePath, "utf-8"), filePath: entry.absolutePath };
    } catch (err) {
      log("error", {
        message: `アクティブファイル読み込み失敗: ${String(err)}`,
        path: entry.absolutePath,
      });
      return {
        content: `# mado\n\nファイルを開けませんでした: \`${entry.absolutePath}\`\n`,
        filePath: entry.absolutePath,
      };
    }
  }

  /**
   * 現在の state + アクティブファイル内容を WebView にブロードキャスト。
   */
  function broadcastState(): void {
    if (!wsServer) return;
    const { content, filePath: activePath } = readActiveContent();
    wsServer.broadcast({
      type: "state",
      files: state.files,
      activeIndex: state.activeIndex,
      content,
      filePath: activePath,
    });
  }

  /**
   * watcher をアクティブファイルに同期する（無ければ停止、変更ならスイッチ）。
   */
  function syncWatcherToActive(): void {
    const entry = activeEntry(state);
    if (!entry) {
      if (watcher) {
        watcher.stop();
        watcher = null;
      }
      return;
    }
    if (!watcher) {
      watcher = startFileWatcher(entry.absolutePath, onWatchedFileChanged);
    } else {
      watcher.switchFile(entry.absolutePath);
    }
  }

  /**
   * Hot Reload: アクティブファイルの内容が変化した時に呼ばれる。
   */
  function onWatchedFileChanged(changedPath: string): void {
    const entry = activeEntry(state);
    if (!entry) return;
    if (path.resolve(entry.absolutePath) !== path.resolve(changedPath)) {
      // アクティブ以外（古い watcher のイベント）は無視
      return;
    }
    log("hot_reload_triggered", { path: changedPath });
    broadcastState();
  }

  // 5a. 初期ファイルを state に追加
  state = addFile(state, buildEntry(filePath));
  {
    const e = activeEntry(state);
    if (e) {
      log("file_list_added", {
        path: e.absolutePath,
        relativePath: e.relativePath,
        total: state.files.length,
      });
    }
  }

  // 6. WebSocket サーバー起動（クライアントメッセージで state 更新）
  wsServer = startWsServer({
    onClientMessage: (msg: ClientMessage) => {
      try {
        handleClientMessage(msg);
      } catch (err) {
        log("error", {
          message: `client message handling failed: ${String(err)}`,
          type: msg.type,
        });
      }
    },
  });

  /**
   * クライアントメッセージを処理する。
   */
  function handleClientMessage(msg: ClientMessage): void {
    if (msg.type === "ready") {
      // 初回 / 再接続時に現状を配信
      broadcastState();
      return;
    }

    if (msg.type === "switch-file") {
      const target = path.resolve(msg.absolutePath);
      const exists = state.files.some(
        (f) => path.resolve(f.absolutePath) === target,
      );
      if (!exists) {
        log("error", { message: "switch-file: unknown path", path: target });
        return;
      }
      const previous = activeEntry(state);
      const next = setActiveByPath(state, target);
      if (next !== state) {
        state = next;
        log("file_list_switched", {
          from: previous?.absolutePath ?? "",
          to: target,
        });
        syncWatcherToActive();
      }
      broadcastState();
      return;
    }

    if (msg.type === "remove-file") {
      const target = path.resolve(msg.absolutePath);
      const exists = state.files.some(
        (f) => path.resolve(f.absolutePath) === target,
      );
      if (!exists) {
        log("error", { message: "remove-file: unknown path", path: target });
        return;
      }
      const previousActive = activeEntry(state);
      state = removeByPath(state, target);
      log("file_list_removed", { path: target, total: state.files.length });

      const nextActive = activeEntry(state);
      const activeChanged =
        previousActive?.absolutePath !== nextActive?.absolutePath;
      if (activeChanged) {
        if (nextActive) {
          syncWatcherToActive();
        } else {
          if (watcher) {
            watcher.stop();
            watcher = null;
          }
          log("file_list_empty", {});
        }
      }
      broadcastState();
      return;
    }
  }

  // 7. BrowserWindow を作成
  const win = new BrowserWindow({
    title: `mado — ${path.basename(filePath)}`,
    frame: { width: 900, height: 700, x: 0, y: 0 },
    url: "views://mainview/index.html",
  });
  log("webview_state_changed", { state: "creating" });

  // 8. DOM 準備完了後の処理（WebSocket 接続を促す。state は client の "ready" で配信）
  win.webview.on("dom-ready", () => {
    log("webview_state_changed", { state: "dom-ready" });

    // WebSocket クライアントを起動（ポートを渡す）
    if (wsServer) {
      win.webview.executeJavascript(`window.__MADO_WS_CONNECT__(${wsServer.port})`);
    }

    // watcher を起動（既に動いていなければ）
    if (!watcher) {
      syncWatcherToActive();
    }
  });

  win.webview.on("did-navigate", () => {
    log("webview_state_changed", { state: "did-navigate" });
    // ページ再読み込み時は client が再度 ready を送って state が再配信される
  });

  // 9. Mermaid エラー通知の受信
  win.on("host-message", (event: unknown) => {
    handleMermaidErrorEvent(event);
  });

  // 10. IPC サーバー起動（2 回目以降の起動からファイルパスを受信）
  const ipcServer = startIpcServer(socketPath, (newFilePath) => {
    try {
      const entry = buildEntry(newFilePath);
      const before = state.files.length;
      const previous = activeEntry(state);
      state = addFile(state, entry);
      const after = state.files.length;

      if (after === before) {
        log("file_list_duplicated", { path: entry.absolutePath, total: after });
      } else {
        log("file_list_added", {
          path: entry.absolutePath,
          relativePath: entry.relativePath,
          total: after,
        });
      }

      const nextActive = activeEntry(state);
      if (previous?.absolutePath !== nextActive?.absolutePath) {
        log("file_list_switched", {
          from: previous?.absolutePath ?? "",
          to: nextActive?.absolutePath ?? "",
        });
        syncWatcherToActive();
      }

      broadcastState();
      console.log(
        `[mado] ファイルを追加しました: ${path.basename(newFilePath)}`,
      );
    } catch (err) {
      log("error", {
        message: `ファイル追加失敗: ${String(err)}`,
        path: newFilePath,
      });
      console.error(`[mado] ファイルを追加できませんでした: ${newFilePath}`);
    }
  });

  // 11. 終了処理
  process.on("beforeExit", () => {
    if (watcher) {
      watcher.stop();
    }
    if (wsServer) {
      wsServer.stop();
    }
    stopIpcServer(ipcServer, socketPath);
    const last = activeEntry(state);
    if (last) {
      log("file_closed", { path: last.absolutePath });
    }
    log("app_exited", { reason: "normal" });
  });
}

main();
