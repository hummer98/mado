/**
 * IPC クライアント（Unix socket）
 *
 * 2回目以降の mado 起動時に、既存プロセスにファイルパスを送信する。
 */

import * as net from "node:net";

/**
 * 既存プロセスにファイルパスを送信する。
 *
 * ソケット接続に成功すればファイルパスを送信して true を返す。
 * 接続に失敗した場合（既存プロセスなし）は false を返す。
 *
 * @param socketPath - 接続先の Unix socket パス
 * @param filePath - 送信するファイルの絶対パス
 * @returns 送信に成功したかどうか
 */
export function sendFileToExistingProcess(
  socketPath: string,
  filePath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      const msg = JSON.stringify({ type: "open-file", filePath });
      client.write(msg);
      client.end();
      resolve(true);
    });

    client.on("error", () => {
      // 接続失敗 = 既存プロセスなし
      resolve(false);
    });
  });
}
