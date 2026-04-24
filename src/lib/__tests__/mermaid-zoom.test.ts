/**
 * mermaid-zoom.ts のユニットテスト (T033)。
 *
 * clampMermaidZoom / wheelDeltaToScaleFactor / refocusTranslate /
 * nextMermaidZoomIn / nextMermaidZoomOut の境界値・不変条件を検証する。
 */

import { describe, expect, test } from "bun:test";
import {
  MERMAID_ZOOM_MIN,
  MERMAID_ZOOM_MAX,
  MERMAID_ZOOM_STEP,
  MERMAID_ZOOM_DEFAULT,
  clampMermaidZoom,
  wheelDeltaToScaleFactor,
  refocusTranslate,
  nextMermaidZoomIn,
  nextMermaidZoomOut,
} from "../mermaid-zoom";

describe("定数", () => {
  test("MIN / MAX / STEP / DEFAULT が仕様値", () => {
    expect(MERMAID_ZOOM_MIN).toBe(0.5);
    expect(MERMAID_ZOOM_MAX).toBe(4.0);
    expect(MERMAID_ZOOM_STEP).toBe(0.1);
    expect(MERMAID_ZOOM_DEFAULT).toBe(1.0);
  });

  test("STEP は T032 (ZOOM_STEP=0.1) と一致する", () => {
    // Review #6: ボタン増分が T032 と揃っていることを明示的にガード
    expect(MERMAID_ZOOM_STEP).toBe(0.1);
  });
});

describe("clampMermaidZoom", () => {
  test("MIN 未満は MIN に丸める", () => {
    expect(clampMermaidZoom(0.3)).toBe(0.5);
    expect(clampMermaidZoom(0)).toBe(0.5);
    expect(clampMermaidZoom(-1)).toBe(0.5);
  });

  test("MAX 超過は MAX に丸める", () => {
    expect(clampMermaidZoom(4.5)).toBe(4.0);
    expect(clampMermaidZoom(10)).toBe(4.0);
  });

  test("範囲内は素通し（wheel 連続値を正規化で丸めない）", () => {
    expect(clampMermaidZoom(1.0)).toBe(1.0);
    expect(clampMermaidZoom(1.25)).toBeCloseTo(1.25, 10);
    expect(clampMermaidZoom(3.7)).toBeCloseTo(3.7, 10);
  });

  test("境界値 (0.5 / 4.0) はそのまま返る", () => {
    expect(clampMermaidZoom(0.5)).toBe(0.5);
    expect(clampMermaidZoom(4.0)).toBe(4.0);
  });

  test("非有限値 (NaN / Infinity) は DEFAULT / 飽和", () => {
    expect(clampMermaidZoom(Number.NaN)).toBe(MERMAID_ZOOM_DEFAULT);
    expect(clampMermaidZoom(Number.POSITIVE_INFINITY)).toBe(MERMAID_ZOOM_MAX);
    expect(clampMermaidZoom(Number.NEGATIVE_INFINITY)).toBe(MERMAID_ZOOM_MIN);
  });
});

describe("wheelDeltaToScaleFactor", () => {
  test("deltaY=0 で倍率 1.0 (変化なし)", () => {
    expect(wheelDeltaToScaleFactor(0)).toBe(1.0);
  });

  test("deltaY<0 で倍率 >1 (拡大)", () => {
    expect(wheelDeltaToScaleFactor(-10)).toBeGreaterThan(1);
    expect(wheelDeltaToScaleFactor(-50)).toBeGreaterThan(1);
  });

  test("deltaY>0 で倍率 <1 (縮小)", () => {
    expect(wheelDeltaToScaleFactor(10)).toBeLessThan(1);
    expect(wheelDeltaToScaleFactor(50)).toBeLessThan(1);
  });

  test("+delta と -delta は逆数の関係 (対称性)", () => {
    const up = wheelDeltaToScaleFactor(-20);
    const down = wheelDeltaToScaleFactor(20);
    expect(up * down).toBeCloseTo(1, 10);
  });

  test("非有限値は 1.0 (no-op)", () => {
    expect(wheelDeltaToScaleFactor(Number.NaN)).toBe(1.0);
    expect(wheelDeltaToScaleFactor(Number.POSITIVE_INFINITY)).toBe(1.0);
  });
});

describe("refocusTranslate", () => {
  test("初期状態 (scale=1, tx=ty=0) で scale=2 へ: focal=(100,50)", () => {
    const result = refocusTranslate(
      { scale: 1, tx: 0, ty: 0 },
      2,
      100,
      50,
    );
    // focalX - sx * nextScale = 100 - 100 * 2 = -100
    expect(result.tx).toBe(-100);
    expect(result.ty).toBe(-50);
  });

  test("focal-point 不変条件: refocus 後も focal が同じ viewport 位置に載る", () => {
    // 「screen 上の focal 位置 = tx + sx * scale」が保たれることを確認
    const prev = { scale: 1, tx: 0, ty: 0 };
    const focalX = 100;
    const focalY = 50;

    // 元の画像座標系での focal 位置
    const origSx = (focalX - prev.tx) / prev.scale;
    const origSy = (focalY - prev.ty) / prev.scale;

    // scale を 2 倍にする
    const next = refocusTranslate(prev, 2, focalX, focalY);
    const newScreenX = next.tx + origSx * 2;
    const newScreenY = next.ty + origSy * 2;

    expect(newScreenX).toBeCloseTo(focalX, 10);
    expect(newScreenY).toBeCloseTo(focalY, 10);
  });

  test("既に translate / scale が入った状態から zoom-in しても focal 不変", () => {
    const prev = { scale: 1.5, tx: -30, ty: -20 };
    const focalX = 200;
    const focalY = 100;

    const origSx = (focalX - prev.tx) / prev.scale;
    const origSy = (focalY - prev.ty) / prev.scale;

    const next = refocusTranslate(prev, 3.0, focalX, focalY);
    const newScreenX = next.tx + origSx * 3.0;
    const newScreenY = next.ty + origSy * 3.0;

    expect(newScreenX).toBeCloseTo(focalX, 10);
    expect(newScreenY).toBeCloseTo(focalY, 10);
  });

  test("scale=prev.scale のとき translate 不変 (prev.tx, prev.ty を返す)", () => {
    const prev = { scale: 2, tx: -50, ty: -30 };
    const next = refocusTranslate(prev, 2, 100, 80);
    expect(next.tx).toBeCloseTo(prev.tx, 10);
    expect(next.ty).toBeCloseTo(prev.ty, 10);
  });
});

describe("nextMermaidZoomIn", () => {
  test("通常ケースで +0.1", () => {
    expect(nextMermaidZoomIn(1.0)).toBeCloseTo(1.1, 10);
    expect(nextMermaidZoomIn(0.5)).toBeCloseTo(0.6, 10);
    expect(nextMermaidZoomIn(3.9)).toBeCloseTo(4.0, 10);
  });

  test("MAX でクランプ (飽和)", () => {
    expect(nextMermaidZoomIn(4.0)).toBe(4.0);
    expect(nextMermaidZoomIn(3.95)).toBe(4.0);
  });

  test("浮動小数点誤差が累積しない (1.0 → +0.1 を 30 回で 4.0)", () => {
    let v = 1.0;
    for (let i = 0; i < 30; i++) {
      v = nextMermaidZoomIn(v);
    }
    expect(v).toBe(4.0);
  });

  test("増分は MERMAID_ZOOM_STEP に一致する", () => {
    // Review #6 の検査: STEP 定数と増分の等価性
    const diff = nextMermaidZoomIn(1.0) - 1.0;
    expect(diff).toBeCloseTo(MERMAID_ZOOM_STEP, 10);
  });
});

describe("nextMermaidZoomOut", () => {
  test("通常ケースで -0.1", () => {
    expect(nextMermaidZoomOut(1.0)).toBeCloseTo(0.9, 10);
    expect(nextMermaidZoomOut(4.0)).toBeCloseTo(3.9, 10);
    expect(nextMermaidZoomOut(0.6)).toBeCloseTo(0.5, 10);
  });

  test("MIN でクランプ (飽和)", () => {
    expect(nextMermaidZoomOut(0.5)).toBe(0.5);
    expect(nextMermaidZoomOut(0.55)).toBe(0.5);
  });

  test("浮動小数点誤差が累積しない (4.0 → -0.1 を 35 回で 0.5)", () => {
    let v = 4.0;
    for (let i = 0; i < 35; i++) {
      v = nextMermaidZoomOut(v);
    }
    expect(v).toBe(0.5);
  });

  test("減分は MERMAID_ZOOM_STEP に一致する", () => {
    const diff = 1.0 - nextMermaidZoomOut(1.0);
    expect(diff).toBeCloseTo(MERMAID_ZOOM_STEP, 10);
  });
});
