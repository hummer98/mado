/**
 * Mermaid 個別の拡大縮小・パンに使う純粋ヘルパ (T033)。
 *
 * WebView 側 (`src/mainview/index.ts`) の `attachMermaidZoom` から呼ばれ、
 * 各 Mermaid SVG に `transform: translate(tx, ty) scale(s)` を書き戻すための
 * 値を計算する。DOM には触らない副作用フリーな関数群。
 *
 * T032 (`zoom-state.ts`) のパターンを踏襲し、STEP=0.1 で浮動小数点誤差を避ける。
 * range は T032 の 0.5〜2.0 より広く 0.5〜4.0 とする（個別ズームは詳細確認目的で
 * 広めを許容 — plan §1.1）。
 */

export const MERMAID_ZOOM_MIN = 0.5;
export const MERMAID_ZOOM_MAX = 4.0;
export const MERMAID_ZOOM_STEP = 0.1;
export const MERMAID_ZOOM_DEFAULT = 1.0;

/** 0.1 刻みに正規化する（浮動小数点誤差除去）。 */
function normalize(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * スケールを [MIN, MAX] にクランプする。
 *
 * - NaN は DEFAULT に倒す（外部入力由来の事故防止）。
 * - +Infinity は MAX、-Infinity は MIN へ飽和。
 * - wheel 由来の連続値を受ける想定なので STEP 正規化はしない。
 *   （ボタン操作は nextMermaidZoomIn/Out 側で 0.1 刻みにする）
 */
export function clampMermaidZoom(value: number): number {
  if (Number.isNaN(value)) return MERMAID_ZOOM_DEFAULT;
  if (value >= MERMAID_ZOOM_MAX) return MERMAID_ZOOM_MAX;
  if (value <= MERMAID_ZOOM_MIN) return MERMAID_ZOOM_MIN;
  return value;
}

/**
 * ホイール / pinch の deltaY を「現在スケールに掛ける倍率」に変換する。
 *
 * macOS trackpad pinch は `wheel + ctrlKey=true` として合成され、deltaY は
 * pinch の 1 フレームあたり ±数〜数十のオーダーで飛んでくる。指数関数ベースに
 * すれば連続合成しても範囲外へ行きにくく、ズーム感度が倍率に対して自然 (linear
 * だとスケールが大きいほど敏感に感じる)。
 *
 * - deltaY < 0 (pinch-out / scroll-up) → 倍率 > 1 (拡大)
 * - deltaY > 0 (pinch-in / scroll-down) → 倍率 < 1 (縮小)
 */
export function wheelDeltaToScaleFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 1.0;
  // 感度係数: 0.01 で pinch 1 段階 (deltaY≈5) あたり ~5% の変化。手元で試した感触に合わせた値。
  return Math.exp(-deltaY * 0.01);
}

/**
 * focal-point zoom: `(focalX, focalY)` を固定したままスケールを nextScale にした時の
 * 新しい translate を返す。
 *
 * 呼び出し側 (`src/mainview/index.ts`) が T032 の outer CSS `zoom` 補正を済ませた
 * **local 座標** を渡す責務を負う。ここはその補正後の値を受けて純粋に式を解くだけ。
 *
 * 式:
 * ```
 *   sx  = (focalX - prev.tx) / prev.scale
 *   sy  = (focalY - prev.ty) / prev.scale
 *   tx' = focalX - sx * nextScale
 *   ty' = focalY - sy * nextScale
 * ```
 */
export function refocusTranslate(
  prev: { scale: number; tx: number; ty: number },
  nextScale: number,
  focalX: number,
  focalY: number,
): { tx: number; ty: number } {
  const sx = (focalX - prev.tx) / prev.scale;
  const sy = (focalY - prev.ty) / prev.scale;
  return {
    tx: focalX - sx * nextScale,
    ty: focalY - sy * nextScale,
  };
}

/** ボタン「+」押下時の次段階スケール（STEP 加算、MAX で飽和）。 */
export function nextMermaidZoomIn(current: number): number {
  const next = normalize(current + MERMAID_ZOOM_STEP);
  if (next >= MERMAID_ZOOM_MAX) return MERMAID_ZOOM_MAX;
  if (next <= MERMAID_ZOOM_MIN) return MERMAID_ZOOM_MIN;
  return next;
}

/** ボタン「−」押下時の次段階スケール（STEP 減算、MIN で飽和）。 */
export function nextMermaidZoomOut(current: number): number {
  const next = normalize(current - MERMAID_ZOOM_STEP);
  if (next >= MERMAID_ZOOM_MAX) return MERMAID_ZOOM_MAX;
  if (next <= MERMAID_ZOOM_MIN) return MERMAID_ZOOM_MIN;
  return next;
}
