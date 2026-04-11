/**
 * IPC サーバー（Unix socket）
 *
 * 既存プロセスがファイルパスを受信するためのサーバー。
 * git root 単位で1つのソケットを listen する。
 */

import { z } from "zod";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { log } from "./logger";

/**
 * IPC メッセージの Zod スキーマ
 * CLAUDE.md: 外部入力は Zod でバリデーションする
 */
const IpcMessageSchema = z.object({
  type: z.literal("open-file"),
  filePath: z.string().min(1),
});

/** ファイルオープン要求のハンドラ型 */
export type FileOpenHandler = (filePath: string) => void;

/**
 * IPC サーバーを起動する。
 *
 * @param socketPath - Unix socket のパス
 * @param onFileOpen - ファイルパスを受信したときのコールバック
 * @returns net.Server インスタンス
 */
export function startIpcServer(
  socketPath: string,
  onFileOpen: FileOpenHandler
): net.Server {
  // ソケットディレクトリを作成
  mkdirSync(path.dirname(socketPath), { recursive: true });

  // 古いソケットファイルを削除（前回の異常終了で残っている場合）
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const server = net.createServer((conn) => {
    let data = "";

    conn.on("data", (chunk) => {
      data += chunk.toString();
    });

    conn.on("end", () => {
      try {
        const raw: unknown = JSON.parse(data);
        const msg = IpcMessageSchema.safeParse(raw);
        if (msg.success) {
          log("ipc_file_received", { path: msg.data.filePath });
          onFileOpen(msg.data.filePath);
        } else {
          log("error", { message: `IPC validation error: ${msg.error.message}` });
        }
      } catch (err) {
        log("error", { message: `IPC parse error: ${String(err)}` });
      }
    });

    conn.on("error", (err) => {
      log("error", { message: `IPC connection error: ${String(err)}` });
    });
  });

  server.listen(socketPath, () => {
    log("ipc_server_started", { socketPath });
  });

  return server;
}

/**
 * IPC サーバーを停止し、ソケットファイルを削除する。
 *
 * @param server - 停止する net.Server
 * @param socketPath - 削除するソケットファイルのパス
 */
export function stopIpcServer(server: net.Server, socketPath: string): void {
  server.close();
  try {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
  } catch (err) {
    log("error", { message: `Socket cleanup error: ${String(err)}` });
  }
}
