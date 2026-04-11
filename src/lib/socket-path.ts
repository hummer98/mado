/**
 * ソケットパス算出
 *
 * git root の絶対パスからユニークな Unix socket パスを生成する。
 * 同じ git root のプロセス同士が通信できるようにする。
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

/**
 * ルートパスからユニークな Unix socket パスを生成する。
 *
 * @param rootPath - git root の絶対パス（または git 外の場合はファイルの親ディレクトリ）
 * @returns $TMPDIR/mado/mado-<hash>.sock 形式のソケットパス
 */
export function getSocketPath(rootPath: string): string {
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 12);
  const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
  return path.join(tmpDir, "mado", `mado-${hash}.sock`);
}
