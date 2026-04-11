/**
 * IPC 通信のテスト（サーバー + クライアント）
 */

import { describe, test, expect, afterEach } from "bun:test";
import { startIpcServer, stopIpcServer } from "../../src/lib/ipc-server";
import { sendFileToExistingProcess } from "../../src/lib/ipc-client";
import { initLogger } from "../../src/lib/logger";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { existsSync, mkdirSync } from "node:fs";

// テスト用のソケットパス
function getTestSocketPath(): string {
  const random = Math.random().toString(36).slice(2, 8);
  const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
  const dir = path.join(tmpDir, "mado-test");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `test-${random}.sock`);
}

// ロガー初期化（テスト全体で1回）
initLogger();

describe("IPC 通信", () => {
  let server: net.Server | null = null;
  let socketPath: string = "";

  afterEach(() => {
    if (server) {
      stopIpcServer(server, socketPath);
      server = null;
    }
  });

  test("サーバー起動後にクライアントから接続できる", async () => {
    socketPath = getTestSocketPath();
    const received: string[] = [];

    server = startIpcServer(socketPath, (filePath) => {
      received.push(filePath);
    });

    // サーバーの listen 完了を少し待つ
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await sendFileToExistingProcess(socketPath, "/test/file.md");
    expect(result).toBe(true);
  });

  test("クライアントから送信したファイルパスをサーバーが受信できる", async () => {
    socketPath = getTestSocketPath();
    const received: string[] = [];

    server = startIpcServer(socketPath, (filePath) => {
      received.push(filePath);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    await sendFileToExistingProcess(socketPath, "/test/file.md");

    // 受信を少し待つ
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("/test/file.md");
  });

  test("複数のファイルパスを連続送信できる", async () => {
    socketPath = getTestSocketPath();
    const received: string[] = [];

    server = startIpcServer(socketPath, (filePath) => {
      received.push(filePath);
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    await sendFileToExistingProcess(socketPath, "/test/file1.md");
    await sendFileToExistingProcess(socketPath, "/test/file2.md");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toHaveLength(2);
    expect(received[0]).toBe("/test/file1.md");
    expect(received[1]).toBe("/test/file2.md");
  });

  test("既存プロセスがない場合はクライアントが false を返す", async () => {
    const nonExistentSocket = getTestSocketPath();
    const result = await sendFileToExistingProcess(
      nonExistentSocket,
      "/test/file.md"
    );
    expect(result).toBe(false);
  });

  test("サーバー停止後にソケットファイルが削除される", async () => {
    socketPath = getTestSocketPath();

    server = startIpcServer(socketPath, () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(existsSync(socketPath)).toBe(true);

    stopIpcServer(server, socketPath);
    server = null;

    expect(existsSync(socketPath)).toBe(false);
  });
});
