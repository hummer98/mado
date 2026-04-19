/**
 * context-menu.ts のユニットテスト
 *
 * buildEntryContextMenu（純粋関数）の構造検証と
 * dispatchEntryContextMenuAction（クリックディスパッチ）の挙動検証を行う。
 */

import { describe, expect, test } from "bun:test";
import {
  ENTRY_COPY_RELATIVE_PATH,
  ENTRY_COPY_ABSOLUTE_PATH,
  ENTRY_COPY_BASENAME,
  ENTRY_REVEAL_IN_FINDER,
  ENTRY_REMOVE_FROM_LIST,
  buildEntryContextMenu,
  dispatchEntryContextMenuAction,
} from "./context-menu";
import type {
  EntryContextMenuDeps,
  EntryContextMenuClickEvent,
} from "./context-menu";

interface Calls {
  copied: string[];
  revealed: string[];
  removed: string[];
}

function makeDeps(overrides: Partial<EntryContextMenuDeps> = {}): {
  deps: EntryContextMenuDeps;
  calls: Calls;
} {
  const calls: Calls = { copied: [], revealed: [], removed: [] };
  const deps: EntryContextMenuDeps = {
    copyToClipboard: (text) => {
      calls.copied.push(text);
    },
    revealInFinder: (absPath) => {
      calls.revealed.push(absPath);
    },
    removeFromList: (absPath) => {
      calls.removed.push(absPath);
    },
    ...overrides,
  };
  return { deps, calls };
}

type MenuItem = ReturnType<typeof buildEntryContextMenu>[number];

function isDivider(item: MenuItem): boolean {
  const t = (item as { type?: string }).type;
  return t === "divider" || t === "separator";
}

const ABS = "/a/b/c.md";
const REL = "b/c.md";

describe("buildEntryContextMenu", () => {
  test("B1: 5 アクション + 2 divider の計 7 項目を返す", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    expect(menu).toHaveLength(7);
  });

  test("B2: 項目 0 は copy-relative-path", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const item = menu[0] as { label?: string; action?: string };
    expect(item.label).toBe("プロジェクト相対パスをコピー");
    expect(item.action).toBe(ENTRY_COPY_RELATIVE_PATH);
  });

  test("B3: 項目 1 は copy-absolute-path", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const item = menu[1] as { action?: string };
    expect(item.action).toBe(ENTRY_COPY_ABSOLUTE_PATH);
  });

  test("B4: 項目 2 は copy-basename", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const item = menu[2] as { action?: string };
    expect(item.action).toBe(ENTRY_COPY_BASENAME);
  });

  test("B5: 項目 3 は divider", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    expect(isDivider(menu[3] as MenuItem)).toBe(true);
  });

  test("B6: 項目 4 は reveal-in-finder", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const item = menu[4] as { action?: string };
    expect(item.action).toBe(ENTRY_REVEAL_IN_FINDER);
  });

  test("B7: 項目 5 は divider", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    expect(isDivider(menu[5] as MenuItem)).toBe(true);
  });

  test("B8: 項目 6 は remove-from-list", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const item = menu[6] as { action?: string };
    expect(item.action).toBe(ENTRY_REMOVE_FROM_LIST);
  });

  test("B9: すべての action 項目に data.absolutePath / data.relativePath が含まれる", () => {
    const menu = buildEntryContextMenu(ABS, REL);
    const actionItems = menu.filter((i) => !isDivider(i as MenuItem));
    expect(actionItems).toHaveLength(5);
    for (const item of actionItems) {
      const data = (item as { data?: { absolutePath?: string; relativePath?: string } }).data;
      expect(data?.absolutePath).toBe(ABS);
      expect(data?.relativePath).toBe(REL);
    }
  });
});

describe("dispatchEntryContextMenuAction", () => {
  test("D1: copy-relative-path → copyToClipboard(relativePath)", () => {
    const { deps, calls } = makeDeps();
    const event: EntryContextMenuClickEvent = {
      action: ENTRY_COPY_RELATIVE_PATH,
      data: { absolutePath: ABS, relativePath: REL },
    };
    dispatchEntryContextMenuAction(event, deps);
    expect(calls.copied).toEqual([REL]);
    expect(calls.revealed).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  test("D2: copy-absolute-path → copyToClipboard(absolutePath)", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_COPY_ABSOLUTE_PATH, data: { absolutePath: ABS, relativePath: REL } },
      deps,
    );
    expect(calls.copied).toEqual([ABS]);
  });

  test("D3: copy-basename → copyToClipboard(basename)", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_COPY_BASENAME, data: { absolutePath: ABS, relativePath: REL } },
      deps,
    );
    expect(calls.copied).toEqual(["c.md"]);
  });

  test("D4: reveal-in-finder → revealInFinder(absolutePath)", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_REVEAL_IN_FINDER, data: { absolutePath: ABS, relativePath: REL } },
      deps,
    );
    expect(calls.revealed).toEqual([ABS]);
    expect(calls.copied).toEqual([]);
  });

  test("D5: remove-from-list → removeFromList(absolutePath)", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_REMOVE_FROM_LIST, data: { absolutePath: ABS, relativePath: REL } },
      deps,
    );
    expect(calls.removed).toEqual([ABS]);
    expect(calls.copied).toEqual([]);
  });

  test("D6: 未知 action → 何も呼ばない・例外なし", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: "entry:unknown", data: { absolutePath: ABS, relativePath: REL } },
      deps,
    );
    expect(calls.copied).toEqual([]);
    expect(calls.revealed).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  test("D7: data === undefined → 何も呼ばない", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction({ action: ENTRY_COPY_ABSOLUTE_PATH }, deps);
    expect(calls.copied).toEqual([]);
    expect(calls.revealed).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  test("D8: data が型不一致 → 何も呼ばない", () => {
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_COPY_ABSOLUTE_PATH, data: { foo: 1 } },
      deps,
    );
    expect(calls.copied).toEqual([]);
  });

  test("D9: 空 absolutePath でも deps を呼ぶ (バリデーションは呼び出し先の責務)", () => {
    // 方針: dispatchEntryContextMenuAction 側は「データ型が正しければ dispatch する」
    // ところまでが責務で、空文字の bounds チェックは Utils.* / handleClientMessage に任せる
    const { deps, calls } = makeDeps();
    dispatchEntryContextMenuAction(
      { action: ENTRY_COPY_ABSOLUTE_PATH, data: { absolutePath: "", relativePath: "" } },
      deps,
    );
    expect(calls.copied).toEqual([""]);
  });
});
