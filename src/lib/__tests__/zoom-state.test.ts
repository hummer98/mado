/**
 * zoom-state.ts のユニットテスト
 *
 * clampZoom / nextZoomIn / nextZoomOut の境界値と浮動小数点誤差累積を検証する。
 */

import { describe, expect, test } from "bun:test";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_DEFAULT,
  clampZoom,
  nextZoomIn,
  nextZoomOut,
} from "../zoom-state";

describe("定数", () => {
  test("ZOOM_MIN / MAX / STEP / DEFAULT が仕様値", () => {
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(2.0);
    expect(ZOOM_STEP).toBe(0.1);
    expect(ZOOM_DEFAULT).toBe(1.0);
  });
});

describe("clampZoom", () => {
  test("MIN 未満は MIN に丸める", () => {
    expect(clampZoom(0.3)).toBe(0.5);
    expect(clampZoom(0)).toBe(0.5);
    expect(clampZoom(-1)).toBe(0.5);
  });

  test("MAX 超過は MAX に丸める", () => {
    expect(clampZoom(3)).toBe(2.0);
    expect(clampZoom(2.5)).toBe(2.0);
  });

  test("MIN/MAX の範囲内は 0.1 刻みに正規化して素通し", () => {
    expect(clampZoom(1.0)).toBe(1.0);
    expect(clampZoom(1.25)).toBe(1.3);
    expect(clampZoom(0.55)).toBeCloseTo(0.6, 10);
  });

  test("境界値 (0.5 / 2.0) はそのまま返る", () => {
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(2.0)).toBe(2.0);
  });

  test("非有限値 (NaN / Infinity) は DEFAULT に戻す", () => {
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(ZOOM_MIN);
  });
});

describe("nextZoomIn", () => {
  test("通常ケースで +0.1", () => {
    expect(nextZoomIn(1.0)).toBeCloseTo(1.1, 10);
    expect(nextZoomIn(0.5)).toBeCloseTo(0.6, 10);
    expect(nextZoomIn(1.9)).toBeCloseTo(2.0, 10);
  });

  test("MAX でクランプ (飽和)", () => {
    expect(nextZoomIn(2.0)).toBe(2.0);
    expect(nextZoomIn(1.95)).toBe(2.0);
  });

  test("浮動小数点誤差が累積しない (1.0 → +0.1 を 10 回で 2.0)", () => {
    let v = 1.0;
    for (let i = 0; i < 10; i++) {
      v = nextZoomIn(v);
    }
    expect(v).toBe(2.0);
  });
});

describe("nextZoomOut", () => {
  test("通常ケースで -0.1", () => {
    expect(nextZoomOut(1.0)).toBeCloseTo(0.9, 10);
    expect(nextZoomOut(2.0)).toBeCloseTo(1.9, 10);
    expect(nextZoomOut(0.6)).toBeCloseTo(0.5, 10);
  });

  test("MIN でクランプ (飽和)", () => {
    expect(nextZoomOut(0.5)).toBe(0.5);
    expect(nextZoomOut(0.55)).toBe(0.5);
  });

  test("浮動小数点誤差が累積しない (1.0 → -0.1 を 5 回で 0.5)", () => {
    let v = 1.0;
    for (let i = 0; i < 5; i++) {
      v = nextZoomOut(v);
    }
    expect(v).toBe(0.5);
  });
});
