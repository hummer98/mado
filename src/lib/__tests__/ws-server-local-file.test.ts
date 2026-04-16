/**
 * WebSocket サーバーのローカルファイル配信テスト
 *
 * /_local/{absolutePath} エンドポイントの挙動を検証する。
 */

import { describe, test, expect, afterEach, beforeAll, afterAll } from "bun:test";
import { startWsServer } from "../ws-server";
import type { WsServer } from "../ws-server";
import { initLogger } from "../logger";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

initLogger();

const tmpDir = path.join(os.tmpdir(), `mado-ws-local-file-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, "test.svg"), "<svg></svg>");
  writeFileSync(path.join(tmpDir, "image.png"), "fake-png-data");
  mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
  writeFileSync(path.join(tmpDir, "sub", "deep.txt"), "deep content");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("/_local/ ファイル配信", () => {
  let server: WsServer | null = null;

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  test("存在するファイルを 200 で返す", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const filePath = path.join(tmpDir, "test.svg");
    const res = await fetch(
      `http://localhost:${server.port}/_local${filePath}`,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("<svg></svg>");
  });

  test("Content-Type が正しく設定される", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const filePath = path.join(tmpDir, "test.svg");
    const res = await fetch(
      `http://localhost:${server.port}/_local${filePath}`,
    );
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type");
    expect(ct).toContain("svg");
  });

  test("サブディレクトリのファイルも配信できる", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const filePath = path.join(tmpDir, "sub", "deep.txt");
    const res = await fetch(
      `http://localhost:${server.port}/_local${filePath}`,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("deep content");
  });

  test("存在しないファイルは 404 を返す", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const res = await fetch(
      `http://localhost:${server.port}/_local${tmpDir}/nonexistent.png`,
    );
    expect(res.status).toBe(404);
  });

  test("allowedRoot 外のパスは 403 を返す", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const res = await fetch(
      `http://localhost:${server.port}/_local/etc/passwd`,
    );
    expect(res.status).toBe(403);
  });

  test("ディレクトリトラバーサルは 403 を返す", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const res = await fetch(
      `http://localhost:${server.port}/_local${tmpDir}/../../../etc/passwd`,
    );
    expect(res.status).toBe(403);
  });

  test("allowedRoot が getter 関数の場合も動作する", async () => {
    server = startWsServer({ allowedRoot: () => tmpDir });
    const filePath = path.join(tmpDir, "test.svg");
    const res = await fetch(
      `http://localhost:${server.port}/_local${filePath}`,
    );
    expect(res.status).toBe(200);
  });

  test("allowedRoot getter が null を返す場合は 403", async () => {
    server = startWsServer({ allowedRoot: () => null });
    const res = await fetch(
      `http://localhost:${server.port}/_local${tmpDir}/test.svg`,
    );
    expect(res.status).toBe(403);
  });

  test("allowedRoot 未指定の場合は 403", async () => {
    server = startWsServer();
    const res = await fetch(
      `http://localhost:${server.port}/_local${tmpDir}/test.svg`,
    );
    expect(res.status).toBe(403);
  });

  test("WebSocket アップグレードは引き続き動作する", async () => {
    server = startWsServer({ allowedRoot: tmpDir });
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });
    expect(opened).toBe(true);
    ws.close();
  });
});
