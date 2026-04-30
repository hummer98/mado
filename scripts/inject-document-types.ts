#!/usr/bin/env bun
/**
 * postBuild / postWrap フックから呼ばれて Info.plist に
 * CFBundleDocumentTypes / LSItemContentTypes を冪等に注入する。
 *
 * 注: stable ビルドでは postBuild 直後に inner bundle が tar.zst へ
 * 圧縮されるため、postBuild の patch は LaunchServices には届かない。
 * 配布物のファイル関連付け挙動を決めるのは postWrap (outer wrapper) のみ。
 * postBuild patch は dev ビルドの利便性確保のためだけに走る。
 *
 * Electrobun が渡す環境変数:
 * - ELECTROBUN_BUILD_DIR     例 build/stable-macos-arm64
 * - ELECTROBUN_APP_NAME      dev: mado-dev / stable: mado
 * - ELECTROBUN_BUILD_ENV     dev / canary / stable
 * - ELECTROBUN_WRAPPER_BUNDLE_PATH (postWrap のみ) outer .app パス
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatTimestamp } from "../src/lib/format-timestamp.ts";

const wrapperPath = process.env["ELECTROBUN_WRAPPER_BUNDLE_PATH"];
const buildDir = process.env["ELECTROBUN_BUILD_DIR"];
const appName = process.env["ELECTROBUN_APP_NAME"];
const buildEnv = process.env["ELECTROBUN_BUILD_ENV"] ?? "unknown";

const plistPath: string | null = wrapperPath
  ? join(wrapperPath, "Contents", "Info.plist")
  : buildDir && appName
    ? join(buildDir, `${appName}.app`, "Contents", "Info.plist")
    : null;

if (!plistPath || !existsSync(plistPath)) {
  // CLAUDE.md ロギングポリシーに合わせて構造化ログ形式で出力する。
  const ts = formatTimestamp(new Date());
  console.error(
    `[${ts}] error event=info_plist_not_found env=${buildEnv} plist=${plistPath ?? "<unresolved>"}`,
  );
  process.exit(1);
}

// process.exit(1) は never を返すため、ここから先は plistPath が string に narrow される。
// クロージャ内（tryDelete）でも narrowing を維持するため、明示的に const へ束縛する。
const resolvedPlistPath: string = plistPath;

const PB = "/usr/libexec/PlistBuddy";

/**
 * PlistBuddy の "Does Not Exist" だけ握りつぶす。
 * permission denied / disk full 等は rethrow して build を落とす。
 */
function tryDelete(key: string): void {
  try {
    execFileSync(PB, ["-c", `Delete :${key}`, resolvedPlistPath], { stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer };
    const stderr = err.stderr?.toString() ?? "";
    if (!/Does Not Exist/.test(stderr)) {
      throw e;
    }
  }
}

tryDelete("CFBundleDocumentTypes");
execFileSync(PB, ["-c", "Add :CFBundleDocumentTypes array", resolvedPlistPath]);
execFileSync(PB, ["-c", "Add :CFBundleDocumentTypes:0 dict", resolvedPlistPath]);
execFileSync(PB, [
  "-c",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Markdown Document",
  resolvedPlistPath,
]);
execFileSync(PB, [
  "-c",
  "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer",
  resolvedPlistPath,
]);
execFileSync(PB, [
  "-c",
  "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate",
  resolvedPlistPath,
]);
execFileSync(PB, [
  "-c",
  "Add :CFBundleDocumentTypes:0:LSItemContentTypes array",
  resolvedPlistPath,
]);
execFileSync(PB, [
  "-c",
  "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string net.daringfireball.markdown",
  resolvedPlistPath,
]);

const target = wrapperPath ? "outer" : "inner";
const ts = formatTimestamp(new Date());
console.log(
  `[${ts}] info_plist_patched env=${buildEnv} target=${target} plist=${resolvedPlistPath} document_types=1`,
);
