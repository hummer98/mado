/**
 * WebSocket サーバーのユニットテスト
 *
 * Bun 組み込みの WebSocket クライアントを使って
 * startWsServer() の挙動を検証する。
 */

import { describe, test, expect, afterEach } from "bun:test";
import { startWsServer } from "../../src/lib/ws-server";
import type { WsServer, WsServerMessage } from "../../src/lib/ws-server";
import { initLogger } from "../../src/lib/logger";

// ロガー初期化（テスト全体で1回）
initLogger();

/** テスト用 WebSocket クライアントを接続し、メッセージ受信を Promise で待つヘルパー */
function connectClient(
  port: number
): Promise<{ ws: WebSocket; messages: WsServerMessage[] }> {
  return new Promise((resolve, reject) => {
    const messages: WsServerMessage[] = [];
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.onopen = () => {
      resolve({ ws, messages });
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data as string) as WsServerMessage;
        messages.push(raw);
      } catch {
        // 無視
      }
    };

    ws.onerror = () => {
      reject(new Error(`WebSocket connection failed to port ${port}`));
    };

    // 接続タイムアウト
    setTimeout(() => reject(new Error("connection timeout")), 3000);
  });
}

/** WebSocket が close されるまで待つヘルパー */
function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.onclose = () => resolve();
    setTimeout(resolve, 1000);
  });
}

describe("ws-server", () => {
  let server: WsServer | null = null;

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  test("ランダムポートでサーバーが起動すること", () => {
    server = startWsServer();
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).toBeLessThanOrEqual(65535);
  });

  test("WebSocket クライアントが接続できること", async () => {
    server = startWsServer();
    const { ws } = await connectClient(server.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("broadcast が接続中クライアントにメッセージを送信すること", async () => {
    server = startWsServer();
    const { ws, messages } = await connectClient(server.port);

    // 接続が安定するまで少し待つ
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msg: WsServerMessage = {
      type: "render",
      content: "# Hello",
      filePath: "/test/test.md",
    };
    server.broadcast(msg);

    // メッセージ受信を待つ
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);

    ws.close();
  });

  test("複数クライアントに同時に broadcast できること", async () => {
    server = startWsServer();
    const [client1, client2] = await Promise.all([
      connectClient(server.port),
      connectClient(server.port),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const msg: WsServerMessage = {
      type: "file-switched",
      content: "# Switched",
      filePath: "/test/new.md",
    };
    server.broadcast(msg);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(client1.messages).toHaveLength(1);
    expect(client1.messages[0]).toEqual(msg);
    expect(client2.messages).toHaveLength(1);
    expect(client2.messages[0]).toEqual(msg);

    client1.ws.close();
    client2.ws.close();
  });

  test("接続が切れたクライアントはリストから除外されること", async () => {
    server = startWsServer();
    const { ws } = await connectClient(server.port);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // クライアントを切断
    ws.close();
    await waitForClose(ws);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 切断後に broadcast してもエラーにならないことを確認
    expect(() => {
      server!.broadcast({ type: "render", content: "# test", filePath: "/test.md" });
    }).not.toThrow();
  });

  test("stop() でサーバーが停止すること", async () => {
    server = startWsServer();
    const port = server.port;

    server.stop();
    server = null;

    // 停止後は新規接続できないことを確認
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.onopen = () => {
        ws.close();
        reject(new Error("should not connect after stop"));
      };
      ws.onerror = () => resolve(undefined);
      setTimeout(() => resolve(undefined), 1000);
    });
  });
});
