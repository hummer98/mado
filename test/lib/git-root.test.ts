/**
 * git root 検出のテスト
 */

import { describe, test, expect } from "bun:test";
import { findGitRoot } from "../../src/lib/git-root";
import * as path from "node:path";
import * as os from "node:os";

describe("findGitRoot", () => {
  test("git リポジトリ内のファイルから git root を検出できる", () => {
    // このテストファイル自体が git リポジトリ内にある
    const result = findGitRoot(__filename);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  test("検出された git root に .git ディレクトリ/ファイルが存在する", () => {
    const result = findGitRoot(__filename);
    expect(result).not.toBeNull();
    // worktree の場合 .git はファイルになるため、existsSync でチェック
    const { existsSync } = require("node:fs");
    expect(existsSync(path.join(result!, ".git"))).toBe(true);
  });

  test("サブディレクトリからも正しい git root を返す", () => {
    // src/lib/ のファイルからも同じ git root を返すはず
    const fromTest = findGitRoot(__filename);
    const fromSrc = findGitRoot(
      path.join(path.dirname(__filename), "../../src/lib/logger.ts")
    );
    expect(fromTest).toBe(fromSrc);
  });

  test("git リポジトリ外のファイルは null を返す", () => {
    // /tmp は通常 git リポジトリ外
    const tmpFile = path.join(os.tmpdir(), "not-in-git.md");
    const result = findGitRoot(tmpFile);
    expect(result).toBeNull();
  });
});
