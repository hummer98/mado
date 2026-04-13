/**
 * computeUpgradeToFileMode (welcome → file mode 遷移 core) のテスト
 */

import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import { computeUpgradeToFileMode } from "../../src/lib/upgrade-mode";

describe("computeUpgradeToFileMode", () => {
  test("welcome 状態で呼ぶと detectedGitRoot / gitRoot / socketPath が確定する", () => {
    const firstAbsPath = "/tmp/project/docs/hello.md";
    const result = computeUpgradeToFileMode({
      firstAbsPath,
      welcomeMode: true,
      findGitRoot: () => "/tmp/project",
    });
    expect(result.kind).toBe("upgraded");
    if (result.kind !== "upgraded") return;
    expect(result.detectedGitRoot).toBe("/tmp/project");
    expect(result.gitRoot).toBe("/tmp/project");
    // socketPath は $TMPDIR/mado/mado-<hash>.sock 形式
    expect(result.socketPath).toMatch(/\/mado\/mado-[0-9a-f]{12}\.sock$/);
  });

  test("git root が検出できない場合は dirname を gitRoot にする (detected は null のまま)", () => {
    const firstAbsPath = "/tmp/loose/file.md";
    const result = computeUpgradeToFileMode({
      firstAbsPath,
      welcomeMode: true,
      findGitRoot: () => null,
    });
    expect(result.kind).toBe("upgraded");
    if (result.kind !== "upgraded") return;
    expect(result.detectedGitRoot).toBeNull();
    expect(result.gitRoot).toBe(path.dirname(firstAbsPath));
  });

  test("welcomeMode=false なら no-op (冪等)", () => {
    const result = computeUpgradeToFileMode({
      firstAbsPath: "/tmp/project/file.md",
      welcomeMode: false,
      findGitRoot: () => {
        throw new Error("呼ばれてはならない");
      },
    });
    expect(result.kind).toBe("noop");
  });
});
