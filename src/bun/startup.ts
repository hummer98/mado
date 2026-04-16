/**
 * 起動モード決定ヘルパ
 *
 * parseCliArgs() の結果から、main() がどの起動モード (file / directory / welcome / error) で
 * 進むかを純関数として決定する。main() から副作用ロジックを切り離してテスト可能にするため。
 */

import type { ParseResult } from "../lib/cli";

export type StartupMode =
  | { kind: "file"; filePath: string }
  | { kind: "directory"; dirPath: string; recursive: boolean }
  | { kind: "welcome" }
  | { kind: "error"; message: string };

/**
 * parseCliArgs 結果から StartupMode を決定する純関数。
 *
 * @param result - parseCliArgs() の戻り値
 * @returns 起動モード
 */
export function decideStartupMode(result: ParseResult): StartupMode {
  if (!result.ok) {
    return { kind: "error", message: result.error };
  }
  if (result.mode === "welcome") {
    return { kind: "welcome" };
  }
  if (result.mode === "directory") {
    return {
      kind: "directory",
      dirPath: result.dirPath,
      recursive: result.recursive,
    };
  }
  return { kind: "file", filePath: result.filePath };
}
