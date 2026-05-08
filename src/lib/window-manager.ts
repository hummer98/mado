/**
 * BrowserWindow の寿命と welcome / file モードを管理するクラス。
 *
 * bun プロセスの寿命と BrowserWindow の寿命を分離するために導入された (T049)。
 * close → 再 create のサイクルを安全に回せるよう、`current` 参照と関連状態
 * (welcomeMode / detectedGitRoot / gitRoot / ipcSocketPath / ipcServer) を
 * このクラスに集約する。
 *
 * 設計方針:
 * - 1 プロセス 1 ウィンドウ前提 (複数ウィンドウは将来課題)
 * - state / wsServer / watcher / recentFiles は持たず、callback (deps) で外部に委譲
 * - close イベントは `win.on("close", ...)` (specifier 付き) で受け、自前 splice は行わない
 * - `win.focus()` は使わず `win.activate()` に統一 (Electrobun 側で deprecated 警告)
 * - welcome → file 遷移時に 1 度だけ ipc server を起動 (冪等)
 */

import type { BrowserWindow as BrowserWindowType } from "electrobun/bun";
import { BrowserWindow } from "electrobun/bun";
import type net from "node:net";
import { computeUpgradeToFileMode } from "./upgrade-mode";
import { log } from "./logger";
import type { WindowBounds, WindowStateStore } from "./window-state";
import type { WindowSummary } from "../bun/menu";

/**
 * WindowManager の依存。テスト時はモック注入できる。
 *
 * 「ウィンドウ寿命と welcome/file モード」以外の責務 (state / wsServer / watcher /
 * recentFiles など) は呼び出し側 (src/bun/index.ts) に残し、callback 経由で連携する。
 */
export interface WindowManagerDeps {
  /** git root 検出。通常は `findGitRoot`。 */
  findGitRoot: (filePath: string) => string | null;
  /** 永続化された window-state を読み込む。 */
  loadWindowStateStore: () => WindowStateStore;
  /** detectedGitRoot からストアキーを算出する。welcome モードでは null を渡す。 */
  resolveStateKey: (gitRoot: string | null) => string;
  /** ストアからキーに対応する bounds を取り出す (無ければ null)。 */
  getBoundsForKey: (
    store: WindowStateStore,
    key: string,
  ) => WindowBounds | null;
  /** bounds をディスプレイにクランプする (画面外補正)。 */
  clampBounds: (bounds: WindowBounds) => WindowBounds;
  /** ウィンドウタイトルを算出する純関数 (`buildWindowTitle`)。 */
  buildTitle: (input: {
    activePath: string | null;
    gitRoot: string | null;
  }) => string;
  /**
   * 現在アクティブなファイルの絶対パス。
   * タイトル生成時 (`createWindow` / `setTitleForActive`) に呼ばれる。
   * 状態は index.ts 側 (`state` / `activeEntry`) に保持されているため callback で参照する。
   */
  getActivePath: () => string | null;
  /**
   * ウィンドウ作成完了時に呼ばれる。
   * dom-ready / did-navigate / host-message / resize / move 等のハンドラ取り付けは
   * ここで行う (WindowManager は具体的な配線を知らない)。
   */
  onWindowCreated: (win: BrowserWindowType, isWelcome: boolean) => void;
  /**
   * ウィンドウクローズ時に呼ばれる。
   * watcher 停止 / saver flush / menu rebuild 等は呼び出し側で行う。
   */
  onWindowClosed: (id: number) => void;
  /**
   * 初回 file モード遷移 (or 起動時 file モード) で IPC サーバーを起動する。
   * `startIpcServer(socketPath, onFileOpen)` のラッパを想定。
   */
  onIpcServerNeeded: (socketPath: string) => net.Server;
  /** IPC サーバー停止 + ソケットファイル削除 (`stopIpcServer`)。 */
  stopIpcServer: (server: net.Server, socketPath: string) => void;
}

/**
 * WindowManager の初期状態。CLI パース結果から組み立てて渡す。
 *
 * - welcome 起動: `{ welcomeMode: true, detectedGitRoot: null, gitRoot: null, ipcSocketPath: null }`
 * - file/directory 起動: `{ welcomeMode: false, ... }` (gitRoot 等は事前に算出済み)
 */
export interface WindowManagerInitialState {
  welcomeMode: boolean;
  detectedGitRoot: string | null;
  gitRoot: string | null;
  ipcSocketPath: string | null;
}

export class WindowManager {
  private current: BrowserWindowType | null = null;
  private welcomeMode: boolean;
  private detectedGitRoot: string | null;
  private gitRoot: string | null;
  private ipcSocketPath: string | null;
  private ipcServer: net.Server | null = null;

  constructor(
    private readonly deps: WindowManagerDeps,
    initial: WindowManagerInitialState,
  ) {
    this.welcomeMode = initial.welcomeMode;
    this.detectedGitRoot = initial.detectedGitRoot;
    this.gitRoot = initial.gitRoot;
    this.ipcSocketPath = initial.ipcSocketPath;
  }

  // ---------------------------------------------------------------------------
  // Getter (R1: 公開 API として明示)
  // ---------------------------------------------------------------------------

  hasActiveWindow(): boolean {
    return this.current !== null;
  }

  getActiveWindow(): BrowserWindowType | null {
    return this.current;
  }

  isWelcomeMode(): boolean {
    return this.welcomeMode;
  }

  getDetectedGitRoot(): string | null {
    return this.detectedGitRoot;
  }

  getGitRoot(): string | null {
    return this.gitRoot;
  }

  getIpcSocketPath(): string | null {
    return this.ipcSocketPath;
  }

  // ---------------------------------------------------------------------------
  // ウィンドウ取得 / 生成
  // ---------------------------------------------------------------------------

  /**
   * ファイルを開くためのウィンドウを取得 (なければ作成) する。
   *
   * - 既存ウィンドウがあればそれを返す (冪等)
   * - welcome モード中なら upgrade を実行 (gitRoot / socketPath 確定)
   * - ipc server が未起動なら `onIpcServerNeeded` を呼んで起動する
   * - 新規ウィンドウを生成し `onWindowCreated(win, false)` を呼ぶ
   */
  getOrCreateWindowForFile(absPath: string): BrowserWindowType {
    if (this.current !== null) {
      return this.current;
    }
    if (this.welcomeMode) {
      this.upgradeToFileMode(absPath);
    }
    this.ensureIpcServer();
    return this.createWindow(false);
  }

  /**
   * welcome 用ウィンドウを取得 (なければ作成) する。
   *
   * - 既存ウィンドウがあればそれを返す
   * - 内部状態の welcomeMode フラグを尊重する
   *   (welcome 起動直後 → welcome ウィンドウ、既に file モードに昇格済み →
   *    既存 gitRoot を使った file モードウィンドウ)
   */
  getOrCreateWelcomeWindow(): BrowserWindowType {
    if (this.current !== null) {
      return this.current;
    }
    return this.createWindow(this.welcomeMode);
  }

  // ---------------------------------------------------------------------------
  // メニュー連携 / アクティブ操作
  // ---------------------------------------------------------------------------

  listWindows(): WindowSummary[] {
    if (this.current === null) return [];
    return [{ id: this.current.id, title: this.current.title }];
  }

  /**
   * 現在のウィンドウを前面化する。
   *
   * 注意: 計画 (T049) では `win.activate()` への統一を要件としていたが、
   * 本リポジトリが依存している Electrobun 1.16.0 の `BrowserWindow` には
   * `activate()` メソッドが存在せず `focus()` のみを公開している
   * (`node_modules/electrobun/dist/api/bun/core/BrowserWindow.ts:266`)。
   * 同バージョンの `focus()` は deprecation 警告を出さないため、`focus()` を
   * そのまま呼ぶ。Electrobun を `activate()` 提供版に更新した時点で差し替える。
   */
  activateActive(): void {
    if (this.current === null) return;
    try {
      this.current.focus();
    } catch (err) {
      log("window_focus_failed", { reason: String(err) });
    }
  }

  /**
   * 現在のウィンドウタイトルを `getActivePath()` + `detectedGitRoot` から再算出して反映する。
   */
  setTitleForActive(): void {
    if (this.current === null) return;
    const title = this.deps.buildTitle({
      activePath: this.deps.getActivePath(),
      gitRoot: this.detectedGitRoot,
    });
    try {
      this.current.setTitle(title);
      log("window_title_updated", { title });
    } catch (err) {
      log("error", {
        message: `window title update failed: ${String(err)}`,
      });
    }
  }

  /**
   * テスト・shutdown 用にすべてのウィンドウを閉じる。
   * 実機ではユーザー操作で閉じるため通常は呼ばない。
   */
  closeAll(): void {
    if (this.current === null) return;
    try {
      this.current.close();
    } catch (err) {
      log("error", { message: `close failed: ${String(err)}` });
    }
    this.current = null;
  }

  /**
   * プロセス終了時の片付け (R2)。
   * ipc server 停止 + ソケットファイル削除を行う。
   */
  shutdown(): void {
    if (this.ipcServer !== null && this.ipcSocketPath !== null) {
      try {
        this.deps.stopIpcServer(this.ipcServer, this.ipcSocketPath);
      } catch (err) {
        log("error", { message: `ipc server shutdown failed: ${String(err)}` });
      }
      this.ipcServer = null;
    }
    this.closeAll();
  }

  // ---------------------------------------------------------------------------
  // 内部実装
  // ---------------------------------------------------------------------------

  /**
   * welcome → file モード遷移。`computeUpgradeToFileMode` で純関数として算出した値を
   * 内部状態に反映し、関連ログを出す。冪等 (welcomeMode=false なら no-op)。
   */
  private upgradeToFileMode(firstAbsPath: string): void {
    const result = computeUpgradeToFileMode({
      firstAbsPath,
      welcomeMode: this.welcomeMode,
      findGitRoot: this.deps.findGitRoot,
    });
    if (result.kind === "noop") return;
    this.detectedGitRoot = result.detectedGitRoot;
    this.gitRoot = result.gitRoot;
    this.ipcSocketPath = result.socketPath;
    this.welcomeMode = false;
    log("git_root_detected", {
      gitRoot: this.gitRoot,
      filePath: firstAbsPath,
      detected: this.detectedGitRoot !== null,
    });
    log("welcome_to_file_transition", {
      path: firstAbsPath,
      gitRoot: this.gitRoot,
    });
  }

  /**
   * file モードでまだ ipc server を起動していなければ起動する (冪等)。
   * welcome モードや socketPath 未確定では起動しない。
   */
  private ensureIpcServer(): void {
    if (this.ipcServer !== null) return;
    if (this.ipcSocketPath === null) return;
    this.ipcServer = this.deps.onIpcServerNeeded(this.ipcSocketPath);
  }

  /**
   * 新規 BrowserWindow を生成する。welcome かどうかで bounds / title が変わる。
   */
  private createWindow(isWelcome: boolean): BrowserWindowType {
    const { bounds, maximized, stateKey } = this.computeInitialBounds(isWelcome);
    const title = this.deps.buildTitle({
      activePath: this.deps.getActivePath(),
      gitRoot: this.detectedGitRoot,
    });

    if (stateKey !== null) {
      log("window_state_loaded", {
        key: stateKey,
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
      });
    }

    const win = new BrowserWindow({
      title,
      frame: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      url: "views://mainview/index.html",
    });
    if (maximized) {
      try {
        win.maximize();
      } catch (err) {
        log("window_state_maximize_failed", { reason: String(err) });
      }
    }
    this.current = win;
    log("window_created", { id: win.id, isWelcome });
    if (isWelcome) {
      log("welcome_window_opened", { windowId: win.id });
    }
    log("webview_state_changed", { state: "creating" });

    // close は specifier 付きで自身の id だけ受信する (D10)。
    win.on("close", () => {
      const id = win.id;
      if (this.current !== null && this.current.id === id) {
        this.current = null;
      }
      log("window_closed", { id });
      try {
        this.deps.onWindowClosed(id);
      } catch (err) {
        log("error", { message: `onWindowClosed failed: ${String(err)}` });
      }
    });

    try {
      this.deps.onWindowCreated(win, isWelcome);
    } catch (err) {
      log("error", { message: `onWindowCreated failed: ${String(err)}` });
    }
    return win;
  }

  /**
   * 新規ウィンドウの初期 bounds を算出する。
   *
   * - welcome モード: 永続化を読まずデフォルト bounds
   * - file モード:    detectedGitRoot からキー解決 → ストア参照 → クランプ
   */
  private computeInitialBounds(isWelcome: boolean): {
    bounds: WindowBounds;
    maximized: boolean;
    stateKey: string | null;
  } {
    if (isWelcome) {
      return {
        bounds: { width: 900, height: 700, x: 0, y: 0 },
        maximized: false,
        stateKey: null,
      };
    }
    const stateKey = this.deps.resolveStateKey(this.detectedGitRoot);
    const store = this.deps.loadWindowStateStore();
    const saved = this.deps.getBoundsForKey(store, stateKey);
    if (saved === null) {
      return {
        bounds: { width: 900, height: 700, x: 0, y: 0 },
        maximized: false,
        stateKey,
      };
    }
    const clamped = this.deps.clampBounds(saved);
    return {
      bounds: clamped,
      maximized: saved.maximized === true,
      stateKey,
    };
  }
}
