/**
 * debounce ユーティリティ
 *
 * 連続呼び出しを抑制し、最後の呼び出しから指定時間経過後にコールバックを実行する。
 */

export interface Debounced<T extends (...args: unknown[]) => void> {
  /** debounce 付きで関数を呼び出す */
  call: (...args: Parameters<T>) => void;
  /** 未実行のコールバックをキャンセルする */
  cancel: () => void;
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): Debounced<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const call = (...args: Parameters<T>): void => {
    // 既存のタイマーをクリアして再設定する
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      fn(...args);
    }, delayMs);
  };

  const cancel = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return { call, cancel };
}
