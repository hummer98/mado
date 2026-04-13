/**
 * welcome → file mode への遷移ロジック (core)
 *
 * 初回ファイル追加時に mutable な gitRoot / detectedGitRoot / socketPath を決定する
 * 純関数。副作用 (IPC server 起動・ログ出力) は呼び出し側 (src/bun/index.ts) が担う。
 */

import * as path from "node:path";
import { getSocketPath } from "./socket-path";

export type UpgradeInput = {
  /** 初回に追加されるファイルの絶対パス */
  firstAbsPath: string;
  /** 現在 welcome モードか。false なら no-op (冪等) */
  welcomeMode: boolean;
  /**
   * git root を検出する関数。テスト容易性のため注入可能。
   * 通常は `findGitRoot`。
   */
  findGitRoot: (filePath: string) => string | null;
};

export type UpgradeResult =
  | {
      kind: "upgraded";
      detectedGitRoot: string | null;
      gitRoot: string;
      socketPath: string;
    }
  | { kind: "noop" };

/**
 * welcome → file mode の遷移に必要な値を算出する。
 *
 * - welcomeMode=false なら何もせず `{ kind: "noop" }` を返す (冪等)。
 * - welcomeMode=true なら `findGitRoot(firstAbsPath)` を呼び、
 *   gitRoot は detected が null の場合は `path.dirname(firstAbsPath)` で fallback する。
 * - socketPath は算出した gitRoot から `getSocketPath` で生成する。
 */
export function computeUpgradeToFileMode(input: UpgradeInput): UpgradeResult {
  if (!input.welcomeMode) {
    return { kind: "noop" };
  }
  const detectedGitRoot = input.findGitRoot(input.firstAbsPath);
  const gitRoot = detectedGitRoot ?? path.dirname(input.firstAbsPath);
  const socketPath = getSocketPath(gitRoot);
  return { kind: "upgraded", detectedGitRoot, gitRoot, socketPath };
}
