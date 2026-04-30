/**
 * ローカルタイムゾーン付き ISO 8601 タイムスタンプを生成する純粋関数。
 *
 * CLAUDE.md §ロギングポリシーで規定される一行ログのフォーマット
 * (`[2026-04-12T10:30:00+09:00] event_name key=value`) に合わせるため、
 * `src/lib/logger.ts` から切り出した。ビルド時スクリプト
 * (`scripts/inject-document-types.ts`) からも import するための独立モジュール。
 *
 * 例: 2026-04-12T10:30:00+09:00
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const min = pad(date.getMinutes());
  const sec = pad(date.getSeconds());

  // TZ オフセット計算
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? "+" : "-";
  const tzHour = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMin = pad(Math.abs(tzOffset) % 60);

  return `${year}-${month}-${day}T${hour}:${min}:${sec}${tzSign}${tzHour}:${tzMin}`;
}
