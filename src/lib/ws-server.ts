/**
 * WebSocket サーバー
 *
 * Bun.serve() の組み込み WebSocket サポートを使って、
 * Hot Reload メッセージを WebView クライアントにブロードキャストする。
 * port: 0 でランダムポートを使用し、複数インスタンス起動時のポート衝突を防ぐ。
 */

import type { ServerWebSocket } from "bun";
import { z } from "zod";
import { log } from "./logger";

/** サーバー → クライアント方向のメッセージ */
export type WsServerMessage =
  | { type: "render"; content: string; filePath: string }
  | { type: "file-switched"; content: string; filePath: string };

/** WebSocket サーバーのインターフェース */
export interface WsServer {
  /** 接続中の全 WebView クライアントにメッセージを送信 */
  broadcast(message: WsServerMessage): void;
  /** サーバーを停止 */
  stop(): void;
  /** 割り当てられたポート番号 */
  readonly port: number;
}

// クライアント → サーバー メッセージスキーマ（将来拡張用）
const ClientMessageSchema = z.object({
  type: z.enum(["ready"]),
});

/**
 * WebSocket サーバーを起動する。
 * port: 0 でランダムな空きポートを OS が割り当てる。
 *
 * @returns WsServer インスタンス（port, broadcast, stop）
 */
export function startWsServer(): WsServer {
  // 接続中クライアントのセット
  const clients = new Set<ServerWebSocket<unknown>>();

  const server = Bun.serve({
    port: 0, // ランダムポート
    websocket: {
      open(ws) {
        clients.add(ws);
        log("ws_client_connected", { total: clients.size });
      },
      close(ws) {
        clients.delete(ws);
        log("ws_client_disconnected", { total: clients.size });
      },
      message(_ws, data) {
        // クライアントメッセージは現状ログのみ（将来: scroll-sync 等）
        try {
          const raw: unknown = JSON.parse(typeof data === "string" ? data : "");
          const msg = ClientMessageSchema.safeParse(raw);
          if (msg.success) {
            log("ws_client_message", { type: msg.data.type });
          }
        } catch {
          // 無効なメッセージは無視
        }
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("WebSocket only", { status: 426 });
    },
  });

  log("ws_server_started", { port: server.port });

  return {
    port: server.port,
    broadcast(message: WsServerMessage): void {
      const json = JSON.stringify(message);
      for (const client of clients) {
        try {
          client.send(json);
        } catch (err) {
          log("error", { message: `ws send failed: ${String(err)}` });
        }
      }
    },
    stop(): void {
      server.stop(true);
      log("ws_server_stopped", {});
    },
  };
}
