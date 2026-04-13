/**
 * メインプロセス（エントリポイント）
 *
 * CLI 引数をパースし、git root 単位でウィンドウを管理する。
 * 同じ git root のプロセスが既に起動中なら IPC でファイルパスを送信して終了する。
 * 初回起動なら BrowserWindow を作成し、IPC サーバー + WS サーバーを起動する。
 *
 * 引数も env.MADO_FILE も無い場合 (Finder/Launchpad 起動) は welcome モードで起動し、
 * ⌘O 等で最初のファイルが追加された時点で file mode に昇格する (`upgradeToFileMode`)。
 *
 * ファイルリストの状態は本プロセスで一元管理し、WebView 側は state メッセージを受け取って描画するだけ。
 */

import Electrobun, { ApplicationMenu, BrowserWindow, Utils } from "electrobun/bun";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import type net from "node:net";
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
import { buildWindowTitle } from "../lib/window-title";
import { decideStartupMode } from "./startup";
import { computeUpgradeToFileMode } from "../lib/upgrade-mode";
import { installApplicationMenu } from "./menu";
import type { WindowSummary } from "./menu";

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
 * Electrobun の close イベントから id を抽出する。未知形式なら null。
 */
function extractClosedWindowId(event: unknown): number | null {
  if (typeof event !== "object" || event === null) return null;
  const data = (event as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
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

  // 1. CLI 引数パース → 起動モード決定
  const parseResult = parseCliArgs(process.argv);
  const startup = decideStartupMode(parseResult);
  if (startup.kind === "error") {
    console.error(`[mado] エラー: ${startup.message}`);
    process.exit(1);
  }

  // welcome か file かで初期化の仕方を切り替える。
  // 共通: gitRoot / detectedGitRoot / ipcServer / socketPath は mutable 化し、
  // welcome → file 遷移時に upgradeToFileMode() で確定する。
  let welcomeMode = startup.kind === "welcome";
  let detectedGitRoot: string | null = null;
  let gitRoot: string | null = null;
  let ipcServer: net.Server | null = null;
  let ipcSocketPath: string | null = null;
  const initialFilePath: string | null =
    startup.kind === "file" ? startup.filePath : null;

  if (startup.kind === "file") {
    // file mode: 既存挙動。CLI 引数 / env.MADO_FILE で明示されたファイルを開く。
    if (parseResult.ok && parseResult.mode === "file") {
      log("cli_parsed", { source: parseResult.source, path: parseResult.filePath });
      parseResult.warnings.forEach((w) => console.warn(`[mado] ${w}`));
    }

    // 2. git root 検出
    //    detectedGitRoot: 実際に検出できたか（null 可）を保持。ウィンドウタイトル生成に使う。
    //    gitRoot:         ソケットパス算出・相対パス計算用に fallback を含んだ値。
    detectedGitRoot = findGitRoot(startup.filePath);
    gitRoot = detectedGitRoot ?? path.dirname(startup.filePath);
    log("git_root_detected", {
      gitRoot,
      filePath: startup.filePath,
      detected: detectedGitRoot !== null,
    });

    // 3. ソケットパス算出
    ipcSocketPath = getSocketPath(gitRoot);

    // 4. 既存プロセスへの委譲を試みる
    const delegated = await sendFileToExistingProcess(ipcSocketPath, startup.filePath);
    if (delegated) {
      log("file_delegated", { path: startup.filePath, gitRoot });
      console.log(
        `[mado] 既存ウィンドウにファイルを送信しました: ${path.basename(startup.filePath)}`,
      );
      process.exit(0);
    }
  } else {
    log("cli_parsed", { source: "none", mode: "welcome" });
  }

  // 5. ファイルリスト状態の初期化
  let state: FileListState = createEmptyState();
  let watcher: FileWatcher | null = null;
  let wsServer: WsServer | null = null;

  /**
   * 絶対パスから FileListEntry を構築する。
   *
   * welcome→file 遷移の冪等性のため、gitRoot はクロージャではなく引数で受け取る
   * (addFileToState 内で upgradeToFileMode を先に呼び、決定済みの gitRoot を渡す)。
   */
  function buildEntry(absPath: string, rootForRelative: string): FileListEntry {
    const abs = path.resolve(absPath);
    const rel = toRelative(abs, rootForRelative);
    if (
      rel === path.basename(abs) &&
      !abs.startsWith(rootForRelative + path.sep) &&
      abs !== rootForRelative
    ) {
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

  // 5a. file mode のみ、初期ファイルを state に追加
  if (!welcomeMode && initialFilePath !== null && gitRoot !== null) {
    state = addFile(state, buildEntry(initialFilePath, gitRoot));
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
        updateWindowTitle();
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
        updateWindowTitle();
      }
      broadcastState();
      return;
    }
  }

  // 7. BrowserWindow を作成
  // welcome モードでは activePath=null, gitRoot=null となり buildWindowTitle が "mado" を返す。
  const knownWindows: Array<{ id: number; title: string }> = [];
  const win = new BrowserWindow({
    title: buildWindowTitle({ activePath: initialFilePath, gitRoot: detectedGitRoot }),
    frame: { width: 900, height: 700, x: 0, y: 0 },
    url: "views://mainview/index.html",
  });
  knownWindows.push({ id: win.id, title: win.title });
  log("webview_state_changed", { state: "creating" });
  if (welcomeMode) {
    log("welcome_window_opened", { windowId: win.id });
  }

  /**
   * welcome → file mode への遷移。最初のファイル追加時に 1 回だけ走る (冪等)。
   * IPC server はここで初めて起動する (welcome 中はプロジェクト未確定のため listen しない)。
   * detectedGitRoot も同時に更新するため、以降の updateWindowTitle() が適切なタイトルを出す。
   */
  function upgradeToFileMode(firstAbsPath: string): void {
    const result = computeUpgradeToFileMode({
      firstAbsPath,
      welcomeMode,
      findGitRoot,
    });
    if (result.kind === "noop") return;
    detectedGitRoot = result.detectedGitRoot;
    gitRoot = result.gitRoot;
    ipcSocketPath = result.socketPath;
    log("git_root_detected", {
      gitRoot,
      filePath: firstAbsPath,
      detected: detectedGitRoot !== null,
    });
    ipcServer = startIpcServer(ipcSocketPath, (newFilePath) => {
      addFileToState(newFilePath);
    });
    welcomeMode = false;
    log("welcome_to_file_transition", { path: firstAbsPath, gitRoot });
  }

  /**
   * 現在のアクティブファイル・検出 gitRoot からタイトルを算出してウィンドウに反映する。
   * active が変化したタイミングと welcome→file 遷移の直後に呼ぶ。
   * detectedGitRoot は mutable で、welcome→file 遷移時に upgradeToFileMode が書き換える。
   */
  function updateWindowTitle(): void {
    const entry = activeEntry(state);
    const title = buildWindowTitle({
      activePath: entry?.absolutePath ?? null,
      gitRoot: detectedGitRoot,
    });
    win.setTitle(title);
    log("window_title_updated", { title });
  }

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

  /**
   * 絶対パスを state に追加し、必要なら watcher 切替と WebView 再配信を行う。
   * IPC 受信経路とメニュー Open... 経路で共通利用する。
   *
   * 不変条件: upgradeToFileMode → buildEntry の順序 (gitRoot 確定後に相対パス計算)。
   */
  function addFileToState(newFilePath: string): void {
    try {
      // welcome モードの場合はここで gitRoot / IPC server を確定させる。
      // 2 回目以降は no-op (冪等)。
      upgradeToFileMode(newFilePath);
      if (gitRoot === null) {
        // upgradeToFileMode が正しく走れば到達不能だが、型的な保険。
        throw new Error("gitRoot が確定していません");
      }
      const entry = buildEntry(newFilePath, gitRoot);
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
        updateWindowTitle();
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
  }

  // 10. IPC サーバー起動（file mode のみ。welcome→file 遷移時は upgradeToFileMode が起動する）
  if (!welcomeMode && ipcSocketPath !== null) {
    ipcServer = startIpcServer(ipcSocketPath, (newFilePath) => {
      addFileToState(newFilePath);
    });
  }

  // 10b. macOS アプリケーションメニューをインストール
  //
  // close イベント時に Window メニューを更新するが、Electrobun 側の close 処理で
  // BrowserWindowMap から削除される前に rebuild() が走ると閉じたウィンドウが
  // 一覧に残る恐れがあるため、queueMicrotask で 1 拍遅延させて実行する。
  const menuCtrl = installApplicationMenu(ApplicationMenu, {
    openMarkdownFile: (absPath) => addFileToState(absPath),
    listWindows: (): WindowSummary[] => knownWindows.slice(),
    focusWindowById: (id) => {
      const target = BrowserWindow.getById(id);
      if (target) {
        target.focus();
      }
    },
    openFileDialog: (opts) => Utils.openFileDialog(opts),
  });

  // ウィンドウ増減を Window メニューへ反映。
  // Electrobun 側 close リスナーで BrowserWindowMap から削除された後に
  // 自前の knownWindows からも削除 → rebuild() の順序を保証するため、
  // close ハンドラ内は queueMicrotask で 1 拍遅延させて実行する。
  Electrobun.events.on("close", (event: unknown) => {
    const closedId = extractClosedWindowId(event);
    if (closedId !== null) {
      const idx = knownWindows.findIndex((w) => w.id === closedId);
      if (idx >= 0) knownWindows.splice(idx, 1);
    }
    queueMicrotask(() => menuCtrl.rebuild());
  });
  // 初期ウィンドウ生成直後にも再構築（タイトル反映等のため）
  queueMicrotask(() => menuCtrl.rebuild());

  // 11. 終了処理
  process.on("beforeExit", () => {
    if (watcher) {
      watcher.stop();
    }
    if (wsServer) {
      wsServer.stop();
    }
    if (ipcServer !== null && ipcSocketPath !== null) {
      stopIpcServer(ipcServer, ipcSocketPath);
    }
    const last = activeEntry(state);
    if (last) {
      log("file_closed", { path: last.absolutePath });
    }
    log("app_exited", { reason: "normal" });
  });
}

main();
