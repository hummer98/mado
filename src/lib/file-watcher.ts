/**
 * ファイル監視モジュール
 *
 * fs.watch + debounce でファイル変更を検知し、コールバックを呼び出す。
 * Hot Reload の基盤として使用される。
 */

import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { debounce } from "./debounce";
import type { Debounced } from "./debounce";
import { log } from "./logger";

export interface FileWatcher {
  /** 監視対象を変更する。前の監視は自動停止。 */
  switchFile(filePath: string): void;
  /** 監視を停止する */
  stop(): void;
}

/** デフォルトの debounce 待ち時間 (ms) */
const DEFAULT_DEBOUNCE_MS = 100;

/**
 * ファイル監視を開始する。
 * fs.watch + debounce でファイル変更を検知し、onChange コールバックを呼ぶ。
 *
 * @param filePath - 監視対象のファイルパス
 * @param onChange - ファイル変更時に呼ばれるコールバック（引数は変更されたファイルパス）
 * @param debounceMs - debounce の待ち時間（デフォルト: 100ms）
 * @returns FileWatcher インターフェース（switchFile / stop）
 */
export function startFileWatcher(
  filePath: string,
  onChange: (filePath: string) => void,
  debounceMs?: number,
): FileWatcher {
  const delay = debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let currentPath = filePath;
  let fsWatcher: FSWatcher | null = null;
  let debounced: Debounced<(path: string) => void> | null = null;

  /**
   * 指定パスの fs.watch を開始し、debounced コールバックを設定する
   */
  function startWatch(watchPath: string): void {
    // debounced コールバックを作成
    debounced = debounce((path: string): void => {
      log("file_changed", { path });
      onChange(path);
    }, delay);

    try {
      fsWatcher = watch(watchPath, () => {
        // ファイル変更イベント発火時に debounce 経由でコールバックを呼ぶ
        debounced!.call(watchPath);
      });

      // watch のエラーハンドリング
      fsWatcher.on("error", (err: Error) => {
        log("watch_failed", { path: watchPath, error: err.message });
      });

      log("watch_started", { path: watchPath });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log("watch_failed", { path: watchPath, error: message });
    }
  }

  /**
   * 現在の fs.watch と debounce を停止する
   */
  function stopWatch(): void {
    if (debounced) {
      debounced.cancel();
      debounced = null;
    }

    if (fsWatcher) {
      try {
        fsWatcher.close();
      } catch (err: unknown) {
        // close 失敗は警告のみ（既に閉じている場合等）
        const message = err instanceof Error ? err.message : String(err);
        log("watch_failed", { path: currentPath, error: `close failed: ${message}` });
      }
      fsWatcher = null;
    }
  }

  // 監視対象を変更する
  function switchFile(newPath: string): void {
    log("watch_stopped", { path: currentPath });
    stopWatch();
    currentPath = newPath;
    startWatch(currentPath);
  }

  // 監視を停止する
  function stop(): void {
    log("watch_stopped", { path: currentPath });
    stopWatch();
  }

  // 初期監視を開始
  startWatch(currentPath);

  return { switchFile, stop };
}
