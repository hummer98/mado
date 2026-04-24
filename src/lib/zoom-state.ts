/**
 * Markdown 表示領域のズーム倍率を扱う純粋ヘルパ (T032)。
 *
 * WebView 側 (`src/mainview/index.ts`) から `.markdown-body` の
 * CSS `zoom` に書き戻すためだけに使う。DOM には触らない副作用フリーな関数群。
 *
 * STEP=0.1 の 10 倍整数化で浮動小数点誤差 (1.0 → +0.1 を 10 回で 1.9999…) を回避する。
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1.0;

/** 0.1 刻みに正規化する（浮動小数点誤差除去）。 */
function normalize(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 倍率を [ZOOM_MIN, ZOOM_MAX] にクランプし、0.1 刻みに正規化する。
 *
 * - NaN は ZOOM_DEFAULT に倒す（外部入力由来の事故防止）。
 * - +Infinity は MAX、-Infinity は MIN へ飽和。
 */
export function clampZoom(value: number): number {
  if (Number.isNaN(value)) return ZOOM_DEFAULT;
  if (value >= ZOOM_MAX) return ZOOM_MAX;
  if (value <= ZOOM_MIN) return ZOOM_MIN;
  return normalize(value);
}

/** 現在値に STEP を足した倍率（MAX で飽和）。 */
export function nextZoomIn(current: number): number {
  return clampZoom(normalize(current + ZOOM_STEP));
}

/** 現在値から STEP を引いた倍率（MIN で飽和）。 */
export function nextZoomOut(current: number): number {
  return clampZoom(normalize(current - ZOOM_STEP));
}
