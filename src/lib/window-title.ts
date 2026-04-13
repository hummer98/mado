/**
 * ウィンドウタイトル生成（純関数）
 *
 * タイトルの形式:
 * - アクティブファイルなし → "mado"
 * - gitRoot あり          → "mado - <basename(gitRoot)> - <toRelative(activePath, gitRoot)>"
 * - gitRoot なし          → "mado - <basename(activePath)>"
 *
 * 副作用なし・Electrobun 依存なし。
 */

import * as path from "node:path";
import { toRelative } from "./file-list";

const APP_NAME = "mado";
const SEPARATOR = " - ";

export interface WindowTitleInput {
  /** アクティブファイルの絶対パス。空状態なら null。path.resolve 済みであること。 */
  activePath: string | null;
  /** git root 絶対パス。検出できなかった場合は null。 */
  gitRoot: string | null;
}

/**
 * ウィンドウタイトルを生成する。
 */
export function buildWindowTitle(input: WindowTitleInput): string {
  const { activePath, gitRoot } = input;

  if (activePath === null) {
    return APP_NAME;
  }

  if (gitRoot === null) {
    return `${APP_NAME}${SEPARATOR}${path.basename(activePath)}`;
  }

  const normalizedRoot = path.resolve(gitRoot);
  const projectName = path.basename(normalizedRoot);
  const relative = toRelative(activePath, normalizedRoot);
  return `${APP_NAME}${SEPARATOR}${projectName}${SEPARATOR}${relative}`;
}
