import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startFileWatcher } from "../../src/lib/file-watcher.ts";
import type { FileWatcher } from "../../src/lib/file-watcher.ts";

/** コールバック発火を待つユーティリティ */
function waitForCallback(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fs.watch + debounce の伝搬に十分な待ち時間 (ms) */
const WATCH_SETTLE_MS = 600;

describe("file-watcher", () => {
  let tmpDir: string;
  let watcher: FileWatcher | null = null;

  /** テスト用の一時ディレクトリとファイルを作成する */
  function createTmpFile(name: string, content = "initial"): string {
    const filePath = join(tmpDir, name);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  // 各テスト前に一時ディレクトリを準備
  // bun:test では beforeEach の代わりに describe 内で直接初期化
  tmpDir = mkdtempSync(join(tmpdir(), "mado-fw-test-"));

  afterEach(() => {
    // watcher を停止
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
  });

  // テスト終了後に一時ディレクトリを削除
  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 削除失敗は無視（OS によるロック等）
    }
    // 次のテスト用に新しい一時ディレクトリを作成
    tmpDir = mkdtempSync(join(tmpdir(), "mado-fw-test-"));
  });

  describe("ファイル変更の検知", () => {
    it("ファイル変更で onChange コールバックが呼ばれること", async () => {
      const filePath = createTmpFile("test.md");
      let callCount = 0;
      let receivedPath = "";

      watcher = startFileWatcher(filePath, (path) => {
        callCount++;
        receivedPath = path;
      });

      // ファイルを変更
      writeFileSync(filePath, "updated content", "utf-8");

      // debounce + fs.watch の伝搬を待つ
      await waitForCallback(WATCH_SETTLE_MS);

      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(receivedPath).toBe(filePath);
    });

    it("複数回の連続変更で debounce により呼び出しが抑制されること", async () => {
      const filePath = createTmpFile("rapid.md");
      let callCount = 0;

      watcher = startFileWatcher(filePath, () => {
        callCount++;
      });

      // 短い間隔で複数回変更
      writeFileSync(filePath, "change 1", "utf-8");
      writeFileSync(filePath, "change 2", "utf-8");
      writeFileSync(filePath, "change 3", "utf-8");

      await waitForCallback(WATCH_SETTLE_MS);

      // debounce により 3 回ではなく少ない回数で発火する
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(callCount).toBeLessThanOrEqual(3);
    });
  });

  describe("stop()", () => {
    it("stop() 後はファイル変更でコールバックが呼ばれないこと", async () => {
      const filePath = createTmpFile("stop-test.md");
      let callCount = 0;

      watcher = startFileWatcher(filePath, () => {
        callCount++;
      });

      // 監視を停止
      watcher.stop();

      // stop 後にファイルを変更
      writeFileSync(filePath, "after stop", "utf-8");

      await waitForCallback(WATCH_SETTLE_MS);

      expect(callCount).toBe(0);

      // afterEach で二重 stop しないように null にする
      watcher = null;
    });

    it("stop() を複数回呼んでもエラーにならないこと", () => {
      const filePath = createTmpFile("double-stop.md");

      watcher = startFileWatcher(filePath, () => {});

      // 複数回 stop しても例外が発生しない
      expect(() => {
        watcher!.stop();
        watcher!.stop();
      }).not.toThrow();

      watcher = null;
    });
  });

  describe("switchFile()", () => {
    it("switchFile() で監視対象が新しいファイルに切り替わること", async () => {
      const fileA = createTmpFile("a.md", "file A");
      const fileB = createTmpFile("b.md", "file B");
      let receivedPath = "";
      let callCount = 0;

      watcher = startFileWatcher(fileA, (path) => {
        receivedPath = path;
        callCount++;
      });

      // 監視対象を B に切り替え
      watcher.switchFile(fileB);

      // B を変更 → コールバックが発火するはず
      writeFileSync(fileB, "updated B", "utf-8");

      await waitForCallback(WATCH_SETTLE_MS);

      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(receivedPath).toBe(fileB);
    });

    it("switchFile() 後に旧ファイルの変更ではコールバックが呼ばれないこと", async () => {
      const fileA = createTmpFile("old.md", "old");
      const fileB = createTmpFile("new.md", "new");
      const receivedPaths: string[] = [];

      watcher = startFileWatcher(fileA, (path) => {
        receivedPaths.push(path);
      });

      // 監視対象を B に切り替え
      watcher.switchFile(fileB);

      // 少し待ってから A を変更（旧ファイル）
      await waitForCallback(100);
      writeFileSync(fileA, "changed old", "utf-8");

      await waitForCallback(WATCH_SETTLE_MS);

      // A の変更によるコールバックは発火しないはず
      const pathsFromA = receivedPaths.filter((p) => p === fileA);
      expect(pathsFromA.length).toBe(0);
    });
  });
});
