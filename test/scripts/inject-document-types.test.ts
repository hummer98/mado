import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/inject-document-types.ts");

const MIN_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>launcher</string>
    <key>CFBundleIdentifier</key><string>com.example.test</string>
    <key>CFBundleName</key><string>test-app</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>0.0.1</string>
</dict>
</plist>
`;

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runScript(env: Record<string, string>): Promise<SpawnResult> {
  // 親プロセスの環境変数を継承しつつ、テスト固有の値で上書きする。
  // ELECTROBUN_* を未設定にしたいケースは個別に削除する。
  const merged: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const k of Object.keys(merged)) {
    if (k.startsWith("ELECTROBUN_")) delete merged[k];
  }
  Object.assign(merged, env);

  const proc = Bun.spawn({
    cmd: ["bun", "run", SCRIPT],
    cwd: REPO_ROOT,
    env: merged,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { exitCode: proc.exitCode ?? -1, stdout, stderr };
}

async function readPlistAsJson(plistPath: string): Promise<unknown> {
  const proc = Bun.spawn({
    cmd: ["/usr/bin/plutil", "-convert", "json", "-o", "-", plistPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(text);
}

interface DocType {
  CFBundleTypeName: string;
  CFBundleTypeRole: string;
  LSHandlerRank: string;
  LSItemContentTypes: string[];
}

interface InfoPlistShape {
  CFBundleDocumentTypes?: DocType[];
}

describe("scripts/inject-document-types", () => {
  let workDir = "";
  let appDir = "";
  let plistPath = "";

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "mado-inject-test-"));
    appDir = path.join(workDir, "mado.app");
    await mkdir(path.join(appDir, "Contents"), { recursive: true });
    plistPath = path.join(appDir, "Contents", "Info.plist");
    await writeFile(plistPath, MIN_INFO_PLIST, "utf-8");
  });

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("postBuild 経由 (inner) で CFBundleDocumentTypes を注入する", async () => {
    const result = await runScript({
      ELECTROBUN_BUILD_DIR: workDir,
      ELECTROBUN_APP_NAME: "mado",
      ELECTROBUN_BUILD_ENV: "dev",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("info_plist_patched");
    expect(result.stdout).toContain("env=dev");
    expect(result.stdout).toContain("target=inner");

    const json = (await readPlistAsJson(plistPath)) as InfoPlistShape;
    expect(json.CFBundleDocumentTypes).toBeArray();
    const docType = json.CFBundleDocumentTypes?.[0];
    expect(docType).toBeDefined();
    expect(docType?.CFBundleTypeName).toBe("Markdown Document");
    expect(docType?.CFBundleTypeRole).toBe("Viewer");
    expect(docType?.LSHandlerRank).toBe("Alternate");
    // 完全一致 (public.plain-text 混入の回帰確認)
    expect(docType?.LSItemContentTypes).toEqual(["net.daringfireball.markdown"]);
  });

  it("postWrap 経由 (outer wrapper) でも同様に注入する", async () => {
    const result = await runScript({
      ELECTROBUN_WRAPPER_BUNDLE_PATH: appDir,
      ELECTROBUN_BUILD_ENV: "stable",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("target=outer");
    expect(result.stdout).toContain("env=stable");

    const json = (await readPlistAsJson(plistPath)) as InfoPlistShape;
    expect(json.CFBundleDocumentTypes?.[0]?.LSItemContentTypes).toEqual([
      "net.daringfireball.markdown",
    ]);
  });

  it("2 回呼んでも同一の結果になる (冪等性)", async () => {
    const env = {
      ELECTROBUN_BUILD_DIR: workDir,
      ELECTROBUN_APP_NAME: "mado",
      ELECTROBUN_BUILD_ENV: "dev",
    };
    const first = await runScript(env);
    expect(first.exitCode).toBe(0);
    const after1 = await readFile(plistPath, "utf-8");

    const second = await runScript(env);
    expect(second.exitCode).toBe(0);
    const after2 = await readFile(plistPath, "utf-8");

    expect(after2).toBe(after1);

    const json = (await readPlistAsJson(plistPath)) as InfoPlistShape;
    expect(json.CFBundleDocumentTypes).toHaveLength(1);
    expect(json.CFBundleDocumentTypes?.[0]?.LSItemContentTypes).toEqual([
      "net.daringfireball.markdown",
    ]);
  });

  it("壊れた plist を渡したら exit code 0 にならない", async () => {
    await writeFile(plistPath, "<<< not a plist >>>", "utf-8");
    const result = await runScript({
      ELECTROBUN_BUILD_DIR: workDir,
      ELECTROBUN_APP_NAME: "mado",
      ELECTROBUN_BUILD_ENV: "dev",
    });
    expect(result.exitCode).not.toBe(0);
  });

  it("Info.plist が存在しないと構造化エラーで exit 1", async () => {
    const result = await runScript({
      ELECTROBUN_BUILD_DIR: path.join(workDir, "missing"),
      ELECTROBUN_APP_NAME: "mado",
      ELECTROBUN_BUILD_ENV: "dev",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("event=info_plist_not_found");
    expect(result.stderr).toContain("env=dev");
    // CLAUDE.md ロギングポリシーのタイムスタンプフォーマット
    expect(result.stderr).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\]/);
  });

  it("環境変数が無いケースは exit 1 (plist パスが解決できない)", async () => {
    const result = await runScript({});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("event=info_plist_not_found");
    expect(existsSync(plistPath)).toBe(true); // 元 plist は触られない
  });
});
