/**
 * git root 検出
 *
 * ファイルパスから git リポジトリのルートディレクトリを検出する。
 * `git rev-parse --show-toplevel` 相当の処理を行う。
 */

import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * 指定されたファイルパスが属する git リポジトリのルートを返す。
 * git リポジトリ外の場合は null を返す。
 *
 * @param filePath - 対象ファイルのパス（相対・絶対どちらでも可）
 * @returns git root の絶対パス、またはリポジトリ外なら null
 */
export function findGitRoot(filePath: string): string | null {
  const dir = path.dirname(path.resolve(filePath));
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}
