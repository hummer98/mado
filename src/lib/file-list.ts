/**
 * ファイルリスト状態管理（純関数群）
 *
 * 左ペインに表示するファイルリストを表現する不変データと、
 * その操作（追加・削除・アクティブ切替・相対パス変換）を提供する。
 * 全ての関数は副作用を持たず、新しい state を返す。
 */

import * as path from "node:path";

export interface FileListEntry {
  /** OS 絶対パス（一意キー、path.resolve 済み） */
  absolutePath: string;
  /** gitRoot からの相対パス（表示用、gitRoot 外は basename） */
  relativePath: string;
}

export interface FileListState {
  /** 追加順のエントリ列（重複なし） */
  files: FileListEntry[];
  /** アクティブな entry の index。空のとき -1 */
  activeIndex: number;
}

/** 空の FileListState を生成する */
export function createEmptyState(): FileListState {
  return { files: [], activeIndex: -1 };
}

/**
 * ファイルを追加する。
 * 同じ absolutePath（path.resolve 正規化後）が既に存在する場合は新規追加せず、
 * activeIndex のみ既存 index に更新する。
 */
export function addFile(state: FileListState, entry: FileListEntry): FileListState {
  const normalizedPath = path.resolve(entry.absolutePath);
  const existingIndex = state.files.findIndex(
    (f) => path.resolve(f.absolutePath) === normalizedPath,
  );
  if (existingIndex >= 0) {
    return { files: state.files, activeIndex: existingIndex };
  }
  const normalized: FileListEntry = {
    absolutePath: normalizedPath,
    relativePath: entry.relativePath,
  };
  const files = [...state.files, normalized];
  return { files, activeIndex: files.length - 1 };
}

/**
 * 指定 absolutePath のエントリを削除する。
 *
 * - 非アクティブ削除: activeIndex は対象 index より大きければ -1 し、それ以外は不変
 * - アクティブ削除: 「次（同 index）→ なければ前（index-1）」の優先順でアクティブ化
 * - 最後の 1 件を削除した場合: activeIndex = -1
 * - 該当パスが存在しない場合: state を変更せずそのまま返す
 */
export function removeByPath(
  state: FileListState,
  absolutePath: string,
): FileListState {
  const normalized = path.resolve(absolutePath);
  const idx = state.files.findIndex(
    (f) => path.resolve(f.absolutePath) === normalized,
  );
  if (idx < 0) return state;

  const files = state.files.filter((_, i) => i !== idx);
  if (files.length === 0) {
    return { files, activeIndex: -1 };
  }

  let activeIndex: number;
  if (idx === state.activeIndex) {
    // アクティブを削除: 次（同 index）→ なければ前（index-1）
    activeIndex = idx < files.length ? idx : idx - 1;
  } else if (idx < state.activeIndex) {
    activeIndex = state.activeIndex - 1;
  } else {
    activeIndex = state.activeIndex;
  }
  return { files, activeIndex };
}

/**
 * 指定 absolutePath をアクティブにする。
 * 該当パスが存在しない場合は state を変更せず返す。
 */
export function setActiveByPath(
  state: FileListState,
  absolutePath: string,
): FileListState {
  const normalized = path.resolve(absolutePath);
  const idx = state.files.findIndex(
    (f) => path.resolve(f.absolutePath) === normalized,
  );
  if (idx < 0) return state;
  if (idx === state.activeIndex) return state;
  return { files: state.files, activeIndex: idx };
}

/** 現在アクティブなエントリ。空状態なら null。 */
export function activeEntry(state: FileListState): FileListEntry | null {
  if (state.activeIndex < 0 || state.activeIndex >= state.files.length) {
    return null;
  }
  return state.files[state.activeIndex] ?? null;
}

/**
 * 絶対パスを gitRoot 相対パスに変換する。
 * 結果が `..` で始まる（gitRoot 外）または絶対パスになる場合は basename にフォールバックする。
 */
export function toRelative(absolutePath: string, gitRoot: string): string {
  const abs = path.resolve(absolutePath);
  const root = path.resolve(gitRoot);
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return path.basename(abs);
  }
  return rel;
}
