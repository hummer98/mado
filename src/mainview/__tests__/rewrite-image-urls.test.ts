/**
 * 画像 URL 書き換えロジックのユニットテスト
 */

import { describe, expect, test } from "bun:test";
import { resolveLocalImageUrl } from "../rewrite-image-urls";

describe("resolveLocalImageUrl", () => {
  const port = 12345;

  test("./docs/banner.svg を絶対パスに解決する", () => {
    const result = resolveLocalImageUrl(
      "./docs/banner.svg",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBe(
      "http://localhost:12345/_local/home/user/project/docs/banner.svg",
    );
  });

  test("../sibling/image.png を絶対パスに解決する", () => {
    const result = resolveLocalImageUrl(
      "../sibling/image.png",
      "/home/user/project/sub/README.md",
      port,
    );
    expect(result).toBe(
      "http://localhost:12345/_local/home/user/project/sibling/image.png",
    );
  });

  test("ファイル名だけの場合も同じディレクトリに解決する", () => {
    const result = resolveLocalImageUrl(
      "image.png",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBe(
      "http://localhost:12345/_local/home/user/project/image.png",
    );
  });

  test("絶対パスはそのまま使う", () => {
    const result = resolveLocalImageUrl(
      "/assets/logo.png",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBe("http://localhost:12345/_local/assets/logo.png");
  });

  test("https:// URL は書き換えない", () => {
    const result = resolveLocalImageUrl(
      "https://example.com/img.png",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBeNull();
  });

  test("http:// URL は書き換えない", () => {
    const result = resolveLocalImageUrl(
      "http://example.com/img.png",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBeNull();
  });

  test("data: URL は書き換えない", () => {
    const result = resolveLocalImageUrl(
      "data:image/png;base64,abc123",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBeNull();
  });

  test("blob: URL は書き換えない", () => {
    const result = resolveLocalImageUrl(
      "blob:http://localhost/abc",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBeNull();
  });

  test("フラグメント (#) のみは書き換えない", () => {
    const result = resolveLocalImageUrl(
      "#section",
      "/home/user/project/README.md",
      port,
    );
    expect(result).toBeNull();
  });
});
