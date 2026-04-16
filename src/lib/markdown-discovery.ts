/**
 * ディレクトリ配下の Markdown ファイルを列挙する純関数。
 *
 * CLI `mado <dir>` / `mado -r <dir>` で左ペインに表示するファイル一覧を作る。
 * - 拡張子: `.md` / `.markdown` （ファイルに関しては大文字小文字を区別する。
 *   理由: plan.md §2-4 のソート方針と同じく、ロケール非依存の挙動を優先）
 * - 除外ディレクトリ: `.git` / ドット始まり / `node_modules`
 * - symlink: ディレクトリは降下しない、ファイル (.md/.markdown) は含める
 * - readdir / statSync のエラーは abort せず errors に記録して続行
 */

import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import * as path from "node:path";

export interface ListMarkdownOptions {
  recursive: boolean;
}

export interface DiscoveryError {
  path: string;
  message: string;
}

export interface ListMarkdownResult {
  /** 絶対パスの配列、コードポイント順でソート済み */
  files: string[];
  /** 除外したディレクトリの相対パス (ルート起点、ロギング用) */
  excludedDirs: string[];
  /** 読み取り失敗したサブディレクトリや壊れた symlink */
  errors: DiscoveryError[];
}

/**
 * 指定名のディレクトリを除外するかを判定する。
 * ルート直下・サブディレクトリ問わず再帰時のみ降下を止めるための判定に使う。
 */
export function isExcludedDir(name: string): boolean {
  if (name === "node_modules") return true;
  // `.git` を含むドット始まり全般 (`.github`, `.venv`, `.claude` 等)
  if (name.startsWith(".")) return true;
  return false;
}

function hasMarkdownExt(filename: string): boolean {
  // `.md` / `.markdown` のみ対象。`.mdx` は含めない。
  const lower = filename.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function listMarkdownFiles(
  dir: string,
  options: ListMarkdownOptions,
): ListMarkdownResult {
  const rootAbs = path.resolve(dir);
  const files: string[] = [];
  const excludedDirs: string[] = [];
  const errors: DiscoveryError[] = [];

  // スタックベース DFS。各要素は (絶対パス, ルートからの相対パス)。
  type Frame = { abs: string; rel: string };
  const stack: Frame[] = [{ abs: rootAbs, rel: "" }];

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    let entries: Dirent[];
    try {
      entries = readdirSync(frame.abs, { withFileTypes: true });
    } catch (err) {
      errors.push({
        path: frame.abs,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 現ディレクトリ内を列挙。後で sort するためここでは順序を気にしない。
    for (const dirent of entries) {
      const fullPath = path.join(frame.abs, dirent.name);
      const relPath = frame.rel === "" ? dirent.name : path.join(frame.rel, dirent.name);

      if (dirent.isSymbolicLink()) {
        // symlink は stat follow して実体を確認する。
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            // ディレクトリ symlink は降下しない (ループ/外部取込 防止)
            continue;
          }
          if (stat.isFile() && hasMarkdownExt(dirent.name)) {
            files.push(fullPath);
          }
        } catch (err) {
          errors.push({
            path: fullPath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      if (dirent.isDirectory()) {
        if (isExcludedDir(dirent.name)) {
          excludedDirs.push(relPath);
          continue;
        }
        if (options.recursive) {
          stack.push({ abs: fullPath, rel: relPath });
        }
        continue;
      }

      if (dirent.isFile() && hasMarkdownExt(dirent.name)) {
        files.push(fullPath);
      }
    }
  }

  files.sort(compareCodePoint);
  excludedDirs.sort(compareCodePoint);
  return { files, excludedDirs, errors };
}
