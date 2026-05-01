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

import Electrobun, { ApplicationMenu, BrowserWindow, ContextMenu, Screen, Utils } from "electrobun/bun";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type net from "node:net";
import { parseCliArgs } from "../lib/cli";
import { listMarkdownFiles } from "../lib/markdown-discovery";
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
import { detectLocale } from "../lib/locale";
import { buildEntryContextMenu, installEntryContextMenu } from "./context-menu";
import {
  DEFAULT_BOUNDS,
  clampBoundsToDisplays,
  createWindowStateSaver,
  getBoundsForKey,
  loadWindowStateStore,
  resolveStateKey,
  type WindowBounds,
  type WindowStateSaver,
} from "../lib/window-state";
import {
  addRecentFile,
  clearRecentFiles,
  loadRecentFiles,
  removeRecentFile,
} from "../lib/recent-files";
import { loadPreferences, savePreferences } from "../lib/preferences";
import type { Preferences } from "../lib/preferences";

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
 * resize/move イベントの event.data から座標を抽出する。
 * 未知形式なら空オブジェクトを返し、呼び出し側は getFrame() にフォールバックする。
 */
function extractBounds(event: unknown): {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
} {
  if (typeof event !== "object" || event === null) return {};
  const data = (event as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return {};
  const d = data as Record<string, unknown>;
  const out: { x?: number; y?: number; width?: number; height?: number } = {};
  if (typeof d.x === "number" && Number.isFinite(d.x)) out.x = d.x;
  if (typeof d.y === "number" && Number.isFinite(d.y)) out.y = d.y;
  if (typeof d.width === "number" && Number.isFinite(d.width)) out.width = d.width;
  if (typeof d.height === "number" && Number.isFinite(d.height)) out.height = d.height;
  return out;
}

/**
 * Screen.getAllDisplays() でクランプを試みる。例外や空配列時は primary でリトライ、
 * それも失敗したら DEFAULT_BOUNDS を返す。
 */
function clampWithDefaultDisplays(bounds: WindowBounds): WindowBounds {
  try {
    const all = Screen.getAllDisplays();
    if (all.length > 0) {
      return clampBoundsToDisplays(bounds, all);
    }
    const primary = Screen.getPrimaryDisplay();
    if (primary.workArea.width > 0 && primary.workArea.height > 0) {
      return clampBoundsToDisplays(bounds, [primary]);
    }
  } catch (err) {
    log("window_state_clamp_failed", { reason: String(err) });
  }
  return { ...DEFAULT_BOUNDS };
}

/**
 * 外部入力の生値を host-message ハンドラ冒頭で記録する。
 * CLAUDE.md §ロギングポリシーの「外部入力のパース前の生値」要件に対応する。
 * 循環参照で JSON.stringify が throw しても String() でフォールバックする（M1）。
 */
function logHostMessageRaw(event: unknown): void {
  let raw: string;
  try {
    raw = JSON.stringify(event).slice(0, 500);
  } catch {
    raw = String(event).slice(0, 500);
  }
  log("host_message_received", { event: raw });
}

/**
 * host-message イベントから左ペイン右クリックメニュー表示要求を処理する。
 * ペイロード形状: `{ type: "show-entry-context-menu", absolutePath: string, relativePath: string }`
 *
 * handleMermaidErrorEvent と同じ 3 段ガード（object → data プロパティ →
 * data.type チェック）で型絞り込みし、自分の type 以外は早期 return する（M2）。
 * 全体を try/catch で包むことで他ハンドラへの波及を防ぐ。
 */
function handleEntryContextMenuRequest(event: unknown): void {
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

    if (data.type !== "show-entry-context-menu") {
      return;
    }

    const absolutePath = data.absolutePath;
    const relativePath = data.relativePath;
    if (
      typeof absolutePath !== "string" ||
      absolutePath === "" ||
      typeof relativePath !== "string"
    ) {
      log("error", { message: "show-entry-context-menu: invalid payload" });
      return;
    }

    log("entry_context_menu_requested", { absolutePath, relativePath });
    ContextMenu.showContextMenu(buildEntryContextMenu(absolutePath, relativePath));
  } catch (err) {
    log("error", { message: `entry context menu request handling failed: ${String(err)}` });
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

  // Open Recent 履歴（プロセス全体で 1 つ）。起動時にロードして以降はメモリ上で同期する。
  // 永続化は recent-files.ts 側で atomic write される。
  // installApplicationMenu 前に呼ばれる経路（directory モード初期ループ）でも安全に
  // 参照できるよう先行宣言する。menuCtrl 自体は遅れて代入されるため null ガードを入れる。
  // 初期値 null の CFA narrowing で `if (menuCtrl)` が `never` 化するのを避けるため、
  // 明示的なユニオン型へ widen する（plan §5 Step 3-4）。
  let recentFiles: string[] = loadRecentFiles();
  let menuCtrl = null as { rebuild: () => void } | null;

  // グローバル preferences (T042): View > Wide Layout など。
  // 永続化ファイルは ~/Library/Application Support/mado/preferences.json
  let preferences: Preferences = loadPreferences();

  // 1. CLI 引数パース → 起動モード決定
  const parseResult = parseCliArgs(process.argv);
  const startup = decideStartupMode(parseResult);

  // 起動時診断ログ: launcher 経由で bun に何が届いているかを事実として残す。
  // 引数・env・cwd のいずれが優先されたかを後から追跡できるよう恒久化する。
  // target_type は startup.kind (file | directory | welcome | error) を記録。
  log("startup_invocation", {
    argv: JSON.stringify(process.argv),
    cwd: process.cwd(),
    env_MADO_FILE: process.env.MADO_FILE ?? "null",
    target_type: startup.kind,
  });

  if (startup.kind === "error") {
    console.error(`[mado] エラー: ${startup.message}`);
    process.exit(1);
  }

  // welcome / file / directory で初期化の仕方を切り替える。
  // 共通: gitRoot / detectedGitRoot / ipcServer / socketPath は mutable 化し、
  // welcome → file 遷移時に upgradeToFileMode() で確定する。
  let welcomeMode = startup.kind === "welcome";
  let detectedGitRoot: string | null = null;
  let gitRoot: string | null = null;
  let ipcServer: net.Server | null = null;
  let ipcSocketPath: string | null = null;

  // 起動時に state に登録するファイル列 (file は単一、welcome は空、directory は列挙結果)。
  let initialFiles: string[] = [];
  // ウィンドウタイトル・初期描画のベースとなるアクティブファイル。
  let activePath: string | null = null;

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

    initialFiles = [startup.filePath];
    activePath = startup.filePath;
  } else if (startup.kind === "directory") {
    // directory mode: 配下の Markdown を列挙して state に一括登録する。
    if (parseResult.ok && parseResult.mode === "directory") {
      log("cli_parsed", {
        source: parseResult.source,
        dirPath: parseResult.dirPath,
        recursive: parseResult.recursive,
      });
      parseResult.warnings.forEach((w) => console.warn(`[mado] ${w}`));
    }

    const discovery = listMarkdownFiles(startup.dirPath, {
      recursive: startup.recursive,
    });
    log("file_list_built", {
      count: discovery.files.length,
      recursive: startup.recursive,
      dir: startup.dirPath,
      excluded: discovery.excludedDirs.length,
      errors: discovery.errors.length,
    });
    for (const e of discovery.errors) {
      log("file_discovery_error", { message: e.message, path: e.path });
    }

    if (discovery.files.length === 0) {
      console.error(
        `[mado] エラー: Markdown ファイルが見つかりませんでした: ${startup.dirPath}`,
      );
      if (!startup.recursive) {
        console.error(
          `[mado] ヒント: -r / --recursive でサブディレクトリも探索できます`,
        );
      }
      process.exit(1);
    }

    // git root 検出は先頭ファイルを起点にする (file モードと同じヘルパを流用)。
    detectedGitRoot = findGitRoot(discovery.files[0]);
    gitRoot = detectedGitRoot ?? startup.dirPath;
    log("git_root_detected", {
      gitRoot,
      filePath: discovery.files[0],
      detected: detectedGitRoot !== null,
    });

    // ソケットパス算出
    ipcSocketPath = getSocketPath(gitRoot);

    // 既存プロセス委譲は先頭ファイルのみ送る (plan.md §要確認事項 #2)。
    const delegated = await sendFileToExistingProcess(
      ipcSocketPath,
      discovery.files[0],
    );
    if (delegated) {
      log("file_delegated", { path: discovery.files[0], gitRoot });
      console.log(
        `[mado] 既存ウィンドウにファイルを送信しました: ${path.basename(discovery.files[0])}`,
      );
      process.exit(0);
    }

    initialFiles = discovery.files;
    activePath = discovery.files[0];
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

  // 5a. file / directory mode で初期ファイルを state に追加する。
  // directory モードでは複数ファイルをループで追加するため、最後のファイルが
  // addFile() によってアクティブ化されてしまう。activePath (= 先頭ファイル) で
  // setActiveByPath を呼んでアクティブを戻す必要がある (plan.md §3 末尾の警告)。
  //
  // Open Recent 履歴 (T041): directory モード初期ループでは履歴に追加しない。
  // 大量ファイル時に履歴が埋め尽くされるのを避け、 macOS Open Recent の慣例
  // 「明示的に開いたファイルだけ並ぶ」に合わせる (plan §2.7)。
  // file mode と directory mode の `activePath`（= 先頭ファイル）のみ 1 件追加する。
  if (!welcomeMode && initialFiles.length > 0 && gitRoot !== null) {
    for (const p of initialFiles) {
      state = addFile(state, buildEntry(p, gitRoot));
    }
    if (activePath !== null) {
      state = setActiveByPath(state, path.resolve(activePath));
    }
    const total = state.files.length;
    const e = activeEntry(state);
    if (e) {
      log("file_list_added", {
        path: e.absolutePath,
        relativePath: e.relativePath,
        total,
      });
    }
    if (activePath !== null) {
      recentFiles = addRecentFile(path.resolve(activePath));
      // この時点で menuCtrl はまだ null。installApplicationMenu の初回 rebuild に吸収される。
      if (menuCtrl) menuCtrl.rebuild();
    }
  }

  // 6. WebSocket サーバー起動（クライアントメッセージで state 更新）
  wsServer = startWsServer({
    allowedRoot: () => gitRoot,
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
  // file mode のみ保存済み bounds を復元する（Welcome は永続化しない仕様）。
  const knownWindows: Array<{ id: number; title: string }> = [];
  const initialStateKey = welcomeMode ? null : resolveStateKey(detectedGitRoot);
  const loadedStore = welcomeMode ? {} : loadWindowStateStore();
  const savedBounds = initialStateKey
    ? getBoundsForKey(loadedStore, initialStateKey)
    : null;
  const initialBounds: WindowBounds = savedBounds
    ? clampWithDefaultDisplays(savedBounds)
    : { ...DEFAULT_BOUNDS };
  if (savedBounds && initialStateKey) {
    log("window_state_loaded", {
      key: initialStateKey,
      width: initialBounds.width,
      height: initialBounds.height,
      x: initialBounds.x,
      y: initialBounds.y,
    });
  }

  const win = new BrowserWindow({
    title: buildWindowTitle({ activePath, gitRoot: detectedGitRoot }),
    frame: {
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
    },
    url: "views://mainview/index.html",
  });
  // 復元時に maximized だった場合はウィンドウ作成直後に最大化する (Review #4)
  if (savedBounds?.maximized === true) {
    try {
      win.maximize();
    } catch (err) {
      log("window_state_maximize_failed", { reason: String(err) });
    }
  }
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
      try {
        win.focus();
      } catch (err) {
        log("window_focus_failed", { reason: String(err) });
      }
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

    // T042: 起動時の Wide Layout 状態を WebView に反映する。
    // executeJavascript は逐次実行されるため、最初の state メッセージで render() が
    // 走る前に maxWidth が設定され、レイアウトのちらつきが起きない。
    // did-navigate 経由で WebView module が再評価されてもこのハンドラで再適用される。
    win.webview.executeJavascript(
      `window.__MADO_SET_WIDE_LAYOUT__(${preferences.wideLayout})`,
    );

    // T043: 検索ボックスの aria-label / title を locale に合わせて切り替える。
    win.webview.executeJavascript(
      `window.__MADO_SET_LOCALE__(${JSON.stringify(detectLocale())})`,
    );

    // watcher を起動（既に動いていなければ）
    if (!watcher) {
      syncWatcherToActive();
    }
  });

  win.webview.on("did-navigate", () => {
    log("webview_state_changed", { state: "did-navigate" });
    // ページ再読み込み時は client が再度 ready を送って state が再配信される
  });

  // 9. host-message の受信
  //
  // 生値ログ → Mermaid エラー → エントリ右クリックメニュー要求 の順で呼ぶ。
  // 各ハンドラは自分の type 以外は早期 return するため共存可能。
  win.on("host-message", (event: unknown) => {
    logHostMessageRaw(event);
    handleMermaidErrorEvent(event);
    handleEntryContextMenuRequest(event);
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

      // Open Recent 履歴を更新する。addFileToState は IPC / メニュー Open... /
      // welcome→file 遷移など「ユーザーが明示的に開いた」経路で呼ばれるため、
      // すべてのケースで履歴に積む（directory モード初期ループは別経路で除外。§2.7）。
      recentFiles = addRecentFile(entry.absolutePath);
      if (menuCtrl) menuCtrl.rebuild();

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
      try {
        win.focus();
      } catch (err) {
        log("window_focus_failed", { reason: String(err) });
      }
    });
  }

  // 10b. macOS アプリケーションメニューをインストール
  //
  // close イベント時に Window メニューを更新するが、Electrobun 側の close 処理で
  // BrowserWindowMap から削除される前に rebuild() が走ると閉じたウィンドウが
  // 一覧に残る恐れがあるため、queueMicrotask で 1 拍遅延させて実行する。
  menuCtrl = installApplicationMenu(ApplicationMenu, {
    openMarkdownFile: (absPath) => addFileToState(absPath),
    listWindows: (): WindowSummary[] => knownWindows.slice(),
    focusWindowById: (id) => {
      const target = BrowserWindow.getById(id);
      if (target) {
        target.focus();
      }
    },
    openFileDialog: (opts) => Utils.openFileDialog(opts),
    // View メニュー: WebView 側の __MADO_ZOOM_* を呼ぶ (T032)。
    // ログは WebView 側 applyZoom が出すため Bun 側では二重記録しない。
    zoomIn: () => win.webview.executeJavascript("window.__MADO_ZOOM_IN__()"),
    zoomOut: () => win.webview.executeJavascript("window.__MADO_ZOOM_OUT__()"),
    zoomReset: () => win.webview.executeJavascript("window.__MADO_ZOOM_RESET__()"),
    // View > Wide Layout (T042): preferences.json でグローバル永続化。
    // checked 表示は build 時に isWideLayout() を読むため、toggle 後は menuCtrl.rebuild() が必須。
    // ※ WebView 側でも applyWideLayout が `console.log` を出す（Zoom と異なり二重出力は意図的：
    //   Bun 側ログは toggle 操作の監査、WebView 側ログは DOM 反映の事実を別系統で残す）。
    isWideLayout: () => preferences.wideLayout,
    toggleWideLayout: () => {
      preferences = { ...preferences, wideLayout: !preferences.wideLayout };
      savePreferences(preferences);
      log("wide_layout_toggled", { wideLayout: preferences.wideLayout });
      // ※ boolean 限定。値域を広げる場合は JSON.stringify を介すこと。
      win.webview.executeJavascript(
        `window.__MADO_SET_WIDE_LAYOUT__(${preferences.wideLayout})`,
      );
      if (menuCtrl) menuCtrl.rebuild();
    },
    // Edit > Find... (T043): WebView 側の __MADO_SHOW_FIND__ を呼ぶ。
    // ログは WebView 側 showFind が出すため Bun 側では二重記録しない（zoom と同じ判断）。
    showFind: () => win.webview.executeJavascript("window.__MADO_SHOW_FIND__()"),
    // Open Recent (T041): 履歴はメインプロセス側の `recentFiles` で一元管理する。
    // listRecentFiles はメニュー再構築時に毎回呼ばれるためコピーを返す（変更を漏らさない）。
    listRecentFiles: () => recentFiles.slice(),
    clearRecentFiles: () => {
      clearRecentFiles();
      recentFiles = [];
      if (menuCtrl) menuCtrl.rebuild();
      log("recent_files_cleared", {});
    },
    removeRecentFile: (p) => {
      recentFiles = removeRecentFile(p);
      if (menuCtrl) menuCtrl.rebuild();
      log("recent_file_removed", { path: p, reason: "missing" });
    },
    fileExists: (p) => existsSync(p),
  });

  // 10b'. 左ペインファイルエントリ用コンテキストメニューをインストール
  //       (installEntryContextMenu はプロセスあたり 1 回のみ呼ぶ)
  installEntryContextMenu(ContextMenu, {
    copyToClipboard: (text) => Utils.clipboardWriteText(text),
    revealInFinder: (absPath) => Utils.showItemInFolder(absPath),
    removeFromList: (absPath) =>
      handleClientMessage({ type: "remove-file", absolutePath: absPath }),
  });

  // 10c. ウィンドウ状態の永続化 (T022)
  //
  // Welcome モードでは saver を生成しない（仕様：welcome は記憶しない）。
  // file mode、または welcome→file 遷移後に ensureSaver() で遅延生成する。
  let saver: WindowStateSaver | null = null;

  function ensureSaver(): WindowStateSaver | null {
    if (saver) return saver;
    if (welcomeMode) return null;
    const key = resolveStateKey(detectedGitRoot);
    saver = createWindowStateSaver({ key });
    return saver;
  }

  function handleBoundsChanged(partial: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): void {
    const s = ensureSaver();
    if (!s) return;
    try {
      const frame = win.getFrame();
      const bounds: WindowBounds = {
        x: Math.round(partial.x ?? frame.x),
        y: Math.round(partial.y ?? frame.y),
        width: Math.round(partial.width ?? frame.width),
        height: Math.round(partial.height ?? frame.height),
        maximized: win.isMaximized(),
      };
      s.schedule(bounds);
    } catch (err) {
      log("window_state_capture_failed", { reason: String(err) });
    }
  }

  win.on("resize", (event) => {
    handleBoundsChanged(extractBounds(event));
  });
  win.on("move", (event) => {
    handleBoundsChanged(extractBounds(event));
  });

  // ウィンドウ増減を Window メニューへ反映。
  // Electrobun 側 close リスナーで BrowserWindowMap から削除された後に
  // 自前の knownWindows からも削除 → rebuild() の順序を保証するため、
  // close ハンドラ内は queueMicrotask で 1 拍遅延させて実行する。
  Electrobun.events.on("close", (event: unknown) => {
    // 閉じる直前に保留中の bounds を同期 flush
    if (saver) saver.flush();
    const closedId = extractClosedWindowId(event);
    if (closedId !== null) {
      const idx = knownWindows.findIndex((w) => w.id === closedId);
      if (idx >= 0) knownWindows.splice(idx, 1);
    }
    queueMicrotask(() => menuCtrl.rebuild());
  });

  // before-quit: アプリ終了前の最終 flush (Review #1 に従い必ず { allow: true } を返す)
  Electrobun.events.on("before-quit", () => {
    if (saver) saver.flush();
    return { allow: true };
  });

  // 初期ウィンドウ生成直後にも再構築（タイトル反映等のため）
  queueMicrotask(() => menuCtrl.rebuild());

  // 11. 終了処理
  process.on("beforeExit", () => {
    if (saver) {
      saver.flush();
      saver.dispose();
      saver = null;
    }
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
