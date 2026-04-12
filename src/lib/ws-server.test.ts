/**
 * ws-server.ts の ClientMessageSchema バリデーションテスト
 */

import { describe, expect, test } from "bun:test";
import { ClientMessageSchema } from "./ws-server";

describe("ClientMessageSchema", () => {
  test("ready メッセージを parse できる", () => {
    const r = ClientMessageSchema.safeParse({ type: "ready" });
    expect(r.success).toBe(true);
  });

  test("switch-file メッセージを parse できる", () => {
    const r = ClientMessageSchema.safeParse({
      type: "switch-file",
      absolutePath: "/a/b.md",
    });
    expect(r.success).toBe(true);
  });

  test("remove-file メッセージを parse できる", () => {
    const r = ClientMessageSchema.safeParse({
      type: "remove-file",
      absolutePath: "/a/b.md",
    });
    expect(r.success).toBe(true);
  });

  test("absolutePath が空文字列のとき reject される", () => {
    const r = ClientMessageSchema.safeParse({
      type: "switch-file",
      absolutePath: "",
    });
    expect(r.success).toBe(false);
  });

  test("未知の type は reject される", () => {
    const r = ClientMessageSchema.safeParse({ type: "unknown" });
    expect(r.success).toBe(false);
  });

  test("absolutePath 欠落で reject される", () => {
    const r = ClientMessageSchema.safeParse({ type: "switch-file" });
    expect(r.success).toBe(false);
  });
});
