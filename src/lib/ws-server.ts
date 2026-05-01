/**
 * WebSocket サーバー
 *
 * Bun.serve() の組み込み WebSocket サポートを使って、
 * Hot Reload・ファイルリスト状態を WebView クライアントにブロードキャストする。
 * port: 0 でランダムポートを使用し、複数インスタンス起動時のポート衝突を防ぐ。
 */

import type { ServerWebSocket } from "bun";
import { resolve as pathResolve } from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { log } from "./logger";
import type { FileListEntry } from "./file-list";

/** サーバー → クライアント方向のメッセージ */
export type WsServerMessage =
  /** @deprecated state 駆動への移行に伴い廃止予定。state メッセージで置き換える。 */
  | { type: "render"; content: string; filePath: string }
  /** @deprecated state 駆動への移行に伴い廃止予定。state メッセージで置き換える。 */
  | { type: "file-switched"; content: string; filePath: string }
  /** ファイルリスト状態 + 現在のアクティブファイル内容を 1 メッセージで配信 */
  | {
      type: "state";
      files: FileListEntry[];
      activeIndex: number;
      content: string;
      filePath: string;
    };

/** クライアント → サーバー方向のメッセージスキーマ */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("switch-file"), absolutePath: z.string().min(1) }),
  z.object({ type: z.literal("remove-file"), absolutePath: z.string().min(1) }),
  z.object({ type: z.literal("open-file"), absolutePath: z.string().min(1) }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** WebSocket サーバーのインターフェース */
export interface WsServer {
  /** 接続中の全 WebView クライアントにメッセージを送信 */
  broadcast(message: WsServerMessage): void;
  /** サーバーを停止 */
  stop(): void;
  /** 割り当てられたポート番号 */
  readonly port: number;
}

export interface StartWsServerOptions {
  /** クライアントメッセージ受信ハンドラ。例外は呼び出し側で捕捉してください。 */
  onClientMessage?: (msg: ClientMessage) => void;
  /** /_local/ で配信を許可するルートディレクトリ。getter 関数も可。 */
  allowedRoot?: string | (() => string | null);
}

/**
 * WebSocket サーバーを起動する。
 * port: 0 でランダムな空きポートを OS が割り当てる。
 *
 * @param options - onClientMessage コールバック等
 * @returns WsServer インスタンス（port, broadcast, stop）
 */
export function startWsServer(options?: StartWsServerOptions): WsServer {
  // 接続中クライアントのセット
  const clients = new Set<ServerWebSocket<unknown>>();
  const onClientMessage = options?.onClientMessage;
  const allowedRootOpt = options?.allowedRoot;

  function resolveAllowedRoot(): string | null {
    if (allowedRootOpt === undefined) return null;
    if (typeof allowedRootOpt === "function") return allowedRootOpt();
    return allowedRootOpt;
  }

  const LOCAL_PREFIX = "/_local/";

  async function handleLocalFile(
    pathname: string,
  ): Promise<Response> {
    const root = resolveAllowedRoot();
    if (root === null) {
      return new Response("Forbidden", { status: 403 });
    }

    const rawPath = decodeURIComponent(pathname.slice(LOCAL_PREFIX.length - 1));
    const normalizedPath = pathResolve(rawPath);
    const normalizedRoot = pathResolve(root);

    if (
      !normalizedPath.startsWith(normalizedRoot + "/") &&
      normalizedPath !== normalizedRoot
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    let realRequestedPath: string;
    try {
      realRequestedPath = await realpath(normalizedPath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }

    let realRoot: string;
    try {
      realRoot = await realpath(normalizedRoot);
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    if (
      !realRequestedPath.startsWith(realRoot + "/") &&
      realRequestedPath !== realRoot
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(realRequestedPath);
    if (!(await file.exists())) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(file);
  }

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
        // クライアントメッセージを Zod でバリデートして onClientMessage に委譲
        let raw: unknown;
        try {
          raw = JSON.parse(typeof data === "string" ? data : "");
        } catch (err) {
          log("error", {
            message: `ws message parse failed: ${String(err)}`,
          });
          return;
        }

        const parsed = ClientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          log("error", {
            message: `ws message schema invalid: ${parsed.error.message}`,
          });
          return;
        }

        log("ws_client_message", { type: parsed.data.type });

        if (onClientMessage) {
          onClientMessage(parsed.data);
        }
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) return;

      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname.startsWith(LOCAL_PREFIX)) {
        return handleLocalFile(url.pathname);
      }

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
