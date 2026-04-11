/**
 * ソケットパス算出のテスト
 */

import { describe, test, expect } from "bun:test";
import { getSocketPath } from "../../src/lib/socket-path";
import * as path from "node:path";
import * as os from "node:os";

describe("getSocketPath", () => {
  test("同じ git root から同じソケットパスが生成される", () => {
    const path1 = getSocketPath("/Users/test/project");
    const path2 = getSocketPath("/Users/test/project");
    expect(path1).toBe(path2);
  });

  test("異なる git root から異なるソケットパスが生成される", () => {
    const path1 = getSocketPath("/Users/test/project-a");
    const path2 = getSocketPath("/Users/test/project-b");
    expect(path1).not.toBe(path2);
  });

  test("ソケットパスが mado ディレクトリ配下にある", () => {
    const socketPath = getSocketPath("/Users/test/project");
    const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
    const expectedDir = path.join(tmpDir, "mado");
    expect(socketPath.startsWith(expectedDir)).toBe(true);
  });

  test("ソケットパスが .sock 拡張子を持つ", () => {
    const socketPath = getSocketPath("/Users/test/project");
    expect(socketPath.endsWith(".sock")).toBe(true);
  });

  test("ソケットパスに mado- プレフィックスが含まれる", () => {
    const socketPath = getSocketPath("/Users/test/project");
    const filename = path.basename(socketPath);
    expect(filename.startsWith("mado-")).toBe(true);
  });
});
