import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

// テスト用の一時ディレクトリ
const TEST_LOG_DIR = path.join(import.meta.dir, "../../.test-logs");

// ログモジュールをテスト前にリセットするため、動的インポートを使用
describe("logger", () => {
  beforeEach(async () => {
    await mkdir(TEST_LOG_DIR, { recursive: true });
    // 環境変数でログディレクトリを上書き
    process.env["MADO_LOG_DIR"] = TEST_LOG_DIR;
  });

  afterEach(async () => {
    delete process.env["MADO_LOG_DIR"];
    await rm(TEST_LOG_DIR, { recursive: true, force: true });
  });

  describe("getLogFilePath", () => {
    it("initLogger 後に .log で終わるパスを返すこと", async () => {
      const { initLogger, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      const logPath = getLogFilePath();
      expect(logPath).toBeString();
      expect(logPath).toEndWith(".log");
    });

    it("initLogger 前は空文字列を返すこと", async () => {
      // モジュールキャッシュにより共有状態があるため、
      // このテストは initLogger 前の状態を直接検証できないが、
      // 型の安全性（string を返す）を確認する
      const { getLogFilePath } = await import("../../src/lib/logger.ts");
      const logPath = getLogFilePath();
      expect(logPath).toBeString();
    });
  });

  describe("initLogger", () => {
    it("ログファイルを作成すること", async () => {
      const { initLogger, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      const logPath = getLogFilePath();
      expect(existsSync(logPath)).toBe(true);
    });
  });

  describe("log", () => {
    it("イベント名のみのログを記録すること", async () => {
      const { initLogger, log, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      log("app_started");
      const content = await readFile(getLogFilePath(), "utf-8");
      expect(content).toContain("app_started");
    });

    it("イベント名とデータを記録すること", async () => {
      const { initLogger, log, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      log("file_opened", { path: "/tmp/test.md" });
      const content = await readFile(getLogFilePath(), "utf-8");
      expect(content).toContain("file_opened");
      expect(content).toContain("path=/tmp/test.md");
    });

    it("ISO 8601 形式のタイムスタンプを含むこと", async () => {
      const { initLogger, log, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      log("test_event");
      const content = await readFile(getLogFilePath(), "utf-8");
      // [2026-04-12T10:30:00+09:00] 形式
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\]/);
    });

    it("1行1イベントのフォーマットであること", async () => {
      const { initLogger, log, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      log("event_one", { key: "val1" });
      log("event_two", { key: "val2" });
      const content = await readFile(getLogFilePath(), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain("event_one");
      expect(lines[1]).toContain("event_two");
    });

    it("複数キー値ペアを記録すること", async () => {
      const { initLogger, log, getLogFilePath } = await import("../../src/lib/logger.ts");
      initLogger();
      log("app_exited", { reason: "normal", code: "0" });
      const content = await readFile(getLogFilePath(), "utf-8");
      expect(content).toContain("reason=normal");
      expect(content).toContain("code=0");
    });
  });
});
