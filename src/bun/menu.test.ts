/**
 * menu.ts のユニットテスト
 *
 * buildApplicationMenu（純粋関数）の構造検証と
 * dispatchMenuAction（クリックディスパッチ）の挙動検証を行う。
 */

import { describe, expect, test } from "bun:test";
import {
  FILE_OPEN_ACTION,
  FILE_OPEN_RECENT_ACTION,
  FILE_OPEN_RECENT_ITEM_ACTION,
  FILE_CLEAR_RECENT_ACTION,
  APP_PREFERENCES_ACTION,
  WINDOW_FOCUS_ACTION,
  VIEW_ZOOM_IN_ACTION,
  VIEW_ZOOM_OUT_ACTION,
  VIEW_ZOOM_RESET_ACTION,
  ACCELERATOR_QUIT,
  ACCELERATOR_HIDE,
  ACCELERATOR_HIDE_OTHERS,
  ACCELERATOR_PREFERENCES,
  ACCELERATOR_OPEN,
  ACCELERATOR_CLOSE,
  ACCELERATOR_MINIMIZE,
  ACCELERATOR_ZOOM_IN,
  ACCELERATOR_ZOOM_OUT,
  ACCELERATOR_ZOOM_RESET,
  buildApplicationMenu,
  dispatchMenuAction,
} from "./menu";
import type { MenuDeps, MenuClickEvent } from "./menu";
import { createT } from "../lib/locale";
import type { Locale } from "../lib/locale";

// テスト中はシステムロケールによらず英語固定で比較する
const TEST_LOCALE: Locale = "en";
const t = createT(TEST_LOCALE);

function makeDeps(overrides: Partial<MenuDeps> = {}): MenuDeps {
  return {
    openMarkdownFile: () => {},
    listWindows: () => [],
    focusWindowById: () => {},
    openFileDialog: async () => [],
    zoomIn: () => {},
    zoomOut: () => {},
    zoomReset: () => {},
    listRecentFiles: () => [],
    clearRecentFiles: () => {},
    removeRecentFile: () => {},
    fileExists: () => true,
    ...overrides,
  };
}

type MenuItem = ReturnType<typeof buildApplicationMenu>[number];

function assertNormal(item: MenuItem): asserts item is Extract<MenuItem, { type?: "normal" }> {
  if ((item as { type?: string }).type === "divider" || (item as { type?: string }).type === "separator") {
    throw new Error("expected normal menu item, got divider");
  }
}

function findByLabel(items: MenuItem[], label: string): MenuItem | undefined {
  return items.find((i) => {
    if ((i as { type?: string }).type === "divider" || (i as { type?: string }).type === "separator") {
      return false;
    }
    return (i as { label?: string }).label === label;
  });
}

function findByRole(items: MenuItem[], role: string): MenuItem | undefined {
  return items.find((i) => (i as { role?: string }).role === role);
}

describe("buildApplicationMenu", () => {
  test("5 つのトップレベルメニュー (mado / File / Edit / View / Window) を返す", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    expect(menu).toHaveLength(5);
    assertNormal(menu[0]!);
    assertNormal(menu[1]!);
    assertNormal(menu[2]!);
    assertNormal(menu[3]!);
    assertNormal(menu[4]!);
    expect((menu[0] as { label?: string }).label).toBe(t("app"));
    expect((menu[1] as { label?: string }).label).toBe(t("file"));
    expect((menu[2] as { label?: string }).label).toBe(t("edit"));
    expect((menu[3] as { label?: string }).label).toBe(t("view"));
    expect((menu[4] as { label?: string }).label).toBe(t("window"));
  });

  test("Application メニューに role:quit + Cmd+Q accelerator がある", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const app = menu[0] as { submenu?: MenuItem[] };
    expect(app.submenu).toBeDefined();
    const quit = findByRole(app.submenu!, "quit");
    expect(quit).toBeDefined();
    expect((quit as { accelerator?: string }).accelerator).toBe(ACCELERATOR_QUIT);
  });

  test("Application メニューに about / hide / hideOthers / showAll の role 項目が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const app = menu[0] as { submenu?: MenuItem[] };
    expect(findByRole(app.submenu!, "about")).toBeDefined();
    const hide = findByRole(app.submenu!, "hide");
    expect(hide).toBeDefined();
    expect((hide as { accelerator?: string }).accelerator).toBe(ACCELERATOR_HIDE);
    const hideOthers = findByRole(app.submenu!, "hideOthers");
    expect(hideOthers).toBeDefined();
    expect((hideOthers as { accelerator?: string }).accelerator).toBe(ACCELERATOR_HIDE_OTHERS);
    expect(findByRole(app.submenu!, "showAll")).toBeDefined();
  });

  test("Preferences は enabled:false かつ APP_PREFERENCES_ACTION を持つ", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const app = menu[0] as { submenu?: MenuItem[] };
    const pref = app.submenu!.find(
      (i) => (i as { action?: string }).action === APP_PREFERENCES_ACTION,
    );
    expect(pref).toBeDefined();
    expect((pref as { enabled?: boolean }).enabled).toBe(false);
    expect((pref as { accelerator?: string }).accelerator).toBe(ACCELERATOR_PREFERENCES);
  });

  test("File メニューの Open... に file:open + Cmd+O が設定される", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const open = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_ACTION,
    );
    expect(open).toBeDefined();
    expect((open as { accelerator?: string }).accelerator).toBe(ACCELERATOR_OPEN);
    expect((open as { enabled?: boolean }).enabled).not.toBe(false);
  });

  test("listRecentFiles が空のとき Open Recent は enabled:false で submenu は [Clear Menu (disabled)] のみ", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const recent = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ACTION,
    );
    expect(recent).toBeDefined();
    expect((recent as { enabled?: boolean }).enabled).toBe(false);
    const sub = (recent as { submenu?: MenuItem[] }).submenu;
    expect(sub).toBeDefined();
    expect(sub!.length).toBe(1);
    const clear = sub![0] as { action?: string; enabled?: boolean; label?: string };
    expect(clear.action).toBe(FILE_CLEAR_RECENT_ACTION);
    expect(clear.enabled).toBe(false);
    expect(clear.label).toBe(t("clearRecent"));
  });

  test("listRecentFiles が 2 件返るとき submenu は [item1, item2, divider, Clear Menu (enabled)]", () => {
    const deps = makeDeps({
      listRecentFiles: () => ["/tmp/a.md", "/tmp/b.md"],
    });
    const menu = buildApplicationMenu(deps, TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const recent = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ACTION,
    );
    expect(recent).toBeDefined();
    expect((recent as { enabled?: boolean }).enabled).not.toBe(false);
    const sub = (recent as { submenu?: MenuItem[] }).submenu!;
    expect(sub.length).toBe(4);

    const item1 = sub[0] as { label?: string; action?: string; data?: { path?: string } };
    expect(item1.label).toBe("a.md");
    expect(item1.action).toBe(FILE_OPEN_RECENT_ITEM_ACTION);
    expect(item1.data?.path).toBe("/tmp/a.md");

    const item2 = sub[1] as { label?: string; action?: string; data?: { path?: string } };
    expect(item2.label).toBe("b.md");
    expect(item2.action).toBe(FILE_OPEN_RECENT_ITEM_ACTION);
    expect(item2.data?.path).toBe("/tmp/b.md");

    const divider = sub[2] as { type?: string };
    expect(divider.type === "divider" || divider.type === "separator").toBe(true);

    const clear = sub[3] as { action?: string; enabled?: boolean };
    expect(clear.action).toBe(FILE_CLEAR_RECENT_ACTION);
    expect(clear.enabled).not.toBe(false);
  });

  test("Open Recent 親項目の action は FILE_OPEN_RECENT_ACTION のまま（互換維持）", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const recent = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ACTION,
    );
    expect(recent).toBeDefined();
  });

  test("submenu 構築時に存在しないファイルは fileExists でフィルタされる", () => {
    const deps = makeDeps({
      listRecentFiles: () => ["/tmp/a.md", "/tmp/missing.md"],
      fileExists: (p) => p !== "/tmp/missing.md",
    });
    const menu = buildApplicationMenu(deps, TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const recent = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ACTION,
    );
    const sub = (recent as { submenu?: MenuItem[] }).submenu!;
    const items = sub.filter(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ITEM_ACTION,
    );
    expect(items).toHaveLength(1);
    expect((items[0] as { data?: { path?: string } }).data?.path).toBe("/tmp/a.md");
  });

  test("File メニューに role:close + Cmd+W が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const file = menu[1] as { submenu?: MenuItem[] };
    const close = findByRole(file.submenu!, "close");
    expect(close).toBeDefined();
    expect((close as { accelerator?: string }).accelerator).toBe(ACCELERATOR_CLOSE);
  });

  test("Window メニューに minimize / zoom / bringAllToFront の role が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const win = menu[4] as { submenu?: MenuItem[] };
    const minimize = findByRole(win.submenu!, "minimize");
    expect(minimize).toBeDefined();
    expect((minimize as { accelerator?: string }).accelerator).toBe(ACCELERATOR_MINIMIZE);
    expect(findByRole(win.submenu!, "zoom")).toBeDefined();
    expect(findByRole(win.submenu!, "bringAllToFront")).toBeDefined();
  });

  test("Window メニュー末尾に listWindows() の結果が動的展開される", () => {
    const deps = makeDeps({
      listWindows: () => [
        { id: 1, title: "README.md" },
        { id: 2, title: "CHANGELOG.md" },
      ],
    });
    const menu = buildApplicationMenu(deps, TEST_LOCALE);
    const win = menu[4] as { submenu?: MenuItem[] };
    const sub = win.submenu!;
    const dynamicItems = sub.filter(
      (i) => (i as { action?: string }).action === WINDOW_FOCUS_ACTION,
    );
    expect(dynamicItems).toHaveLength(2);
    const first = dynamicItems[0] as { label?: string; data?: { winId: number } };
    const second = dynamicItems[1] as { label?: string; data?: { winId: number } };
    expect(first.label).toBe("README.md");
    expect(first.data?.winId).toBe(1);
    expect(second.label).toBe("CHANGELOG.md");
    expect(second.data?.winId).toBe(2);
  });

  test("listWindows() が 0 件なら動的項目は展開されない", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const win = menu[4] as { submenu?: MenuItem[] };
    const dynamicItems = win.submenu!.filter(
      (i) => (i as { action?: string }).action === WINDOW_FOCUS_ACTION,
    );
    expect(dynamicItems).toHaveLength(0);
  });
});

describe("buildApplicationMenu > Edit メニュー", () => {
  test("Edit メニューは menu[2] に存在し t('edit') のラベルを持つ", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const edit = menu[2] as { label?: string; submenu?: MenuItem[] };
    expect(edit.label).toBe(t("edit"));
    expect(edit.submenu).toBeDefined();
  });

  test("Edit submenu に copy / paste / selectAll の role が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const edit = menu[2] as { submenu?: MenuItem[] };
    expect(findByRole(edit.submenu!, "copy")).toBeDefined();
    expect(findByRole(edit.submenu!, "paste")).toBeDefined();
    expect(findByRole(edit.submenu!, "selectAll")).toBeDefined();
  });

  test("Edit submenu に cut / undo / redo の role が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const edit = menu[2] as { submenu?: MenuItem[] };
    expect(findByRole(edit.submenu!, "cut")).toBeDefined();
    expect(findByRole(edit.submenu!, "undo")).toBeDefined();
    expect(findByRole(edit.submenu!, "redo")).toBeDefined();
  });

  test("Edit submenu に pasteAndMatchStyle / delete の role が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const edit = menu[2] as { submenu?: MenuItem[] };
    expect(findByRole(edit.submenu!, "pasteAndMatchStyle")).toBeDefined();
    expect(findByRole(edit.submenu!, "delete")).toBeDefined();
  });

  test("Edit submenu の順序は undo → redo → divider → cut → copy → paste → pasteAndMatchStyle → delete → selectAll", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const edit = menu[2] as { submenu?: MenuItem[] };
    const seq = edit.submenu!.map((i) => {
      const type = (i as { type?: string }).type;
      if (type === "divider" || type === "separator") return "divider";
      return (i as { role?: string }).role ?? "(unknown)";
    });
    expect(seq).toEqual([
      "undo",
      "redo",
      "divider",
      "cut",
      "copy",
      "paste",
      "pasteAndMatchStyle",
      "delete",
      "selectAll",
    ]);
  });
});

describe("buildApplicationMenu > View メニュー", () => {
  test("View メニューは menu[3] に存在し t('view') のラベルを持つ", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const view = menu[3] as { label?: string; submenu?: MenuItem[] };
    expect(view.label).toBe(t("view"));
    expect(view.submenu).toBeDefined();
  });

  test("View submenu に 拡大 / 縮小 / 実寸 が正しい順序で並び、action / accelerator が設定される", () => {
    const menu = buildApplicationMenu(makeDeps(), TEST_LOCALE);
    const view = menu[3] as { submenu?: MenuItem[] };
    const sub = view.submenu!;
    expect(sub).toHaveLength(3);

    const zoomIn = sub[0] as {
      label?: string;
      action?: string;
      accelerator?: string;
    };
    const zoomOut = sub[1] as {
      label?: string;
      action?: string;
      accelerator?: string;
    };
    const zoomReset = sub[2] as {
      label?: string;
      action?: string;
      accelerator?: string;
    };

    expect(zoomIn.label).toBe(t("zoomIn"));
    expect(zoomIn.action).toBe(VIEW_ZOOM_IN_ACTION);
    expect(zoomIn.accelerator).toBe(ACCELERATOR_ZOOM_IN);

    expect(zoomOut.label).toBe(t("zoomOut"));
    expect(zoomOut.action).toBe(VIEW_ZOOM_OUT_ACTION);
    expect(zoomOut.accelerator).toBe(ACCELERATOR_ZOOM_OUT);

    expect(zoomReset.label).toBe(t("actualSize"));
    expect(zoomReset.action).toBe(VIEW_ZOOM_RESET_ACTION);
    expect(zoomReset.accelerator).toBe(ACCELERATOR_ZOOM_RESET);
  });
});

describe("dispatchMenuAction", () => {
  test("file:open → openFileDialog の戻り値で openMarkdownFile を呼ぶ", async () => {
    const opened: string[] = [];
    const deps = makeDeps({
      openFileDialog: async () => ["/tmp/foo.md"],
      openMarkdownFile: (p) => opened.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_ACTION }, deps);
    expect(opened).toEqual(["/tmp/foo.md"]);
  });

  test("file:open でキャンセル (空文字) なら何もしない", async () => {
    const opened: string[] = [];
    const deps = makeDeps({
      openFileDialog: async () => [""],
      openMarkdownFile: (p) => opened.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_ACTION }, deps);
    expect(opened).toEqual([]);
  });

  test("file:open で空配列なら何もしない", async () => {
    const opened: string[] = [];
    const deps = makeDeps({
      openFileDialog: async () => [],
      openMarkdownFile: (p) => opened.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_ACTION }, deps);
    expect(opened).toEqual([]);
  });

  test("file:open で .md / .markdown 以外は無視する", async () => {
    const opened: string[] = [];
    const deps = makeDeps({
      openFileDialog: async () => ["/tmp/image.png"],
      openMarkdownFile: (p) => opened.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_ACTION }, deps);
    expect(opened).toEqual([]);
  });

  test("file:open で .markdown 拡張子も許可する", async () => {
    const opened: string[] = [];
    const deps = makeDeps({
      openFileDialog: async () => ["/tmp/notes.markdown"],
      openMarkdownFile: (p) => opened.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_ACTION }, deps);
    expect(opened).toEqual(["/tmp/notes.markdown"]);
  });

  test("window:focus → focusWindowById に winId を渡す", async () => {
    const focused: number[] = [];
    const deps = makeDeps({
      focusWindowById: (id) => focused.push(id),
    });
    const event: MenuClickEvent = {
      action: WINDOW_FOCUS_ACTION,
      data: { winId: 42 },
    };
    await dispatchMenuAction(event, deps);
    expect(focused).toEqual([42]);
  });

  test("window:focus で不正 data なら何もしない", async () => {
    const focused: number[] = [];
    const deps = makeDeps({
      focusWindowById: (id) => focused.push(id),
    });
    await dispatchMenuAction({ action: WINDOW_FOCUS_ACTION, data: {} }, deps);
    expect(focused).toEqual([]);
  });

  test("view:zoom-in → deps.zoomIn を呼ぶ", async () => {
    let called = 0;
    const deps = makeDeps({ zoomIn: () => called++ });
    await dispatchMenuAction({ action: VIEW_ZOOM_IN_ACTION }, deps);
    expect(called).toBe(1);
  });

  test("view:zoom-out → deps.zoomOut を呼ぶ", async () => {
    let called = 0;
    const deps = makeDeps({ zoomOut: () => called++ });
    await dispatchMenuAction({ action: VIEW_ZOOM_OUT_ACTION }, deps);
    expect(called).toBe(1);
  });

  test("view:zoom-reset → deps.zoomReset を呼ぶ", async () => {
    let called = 0;
    const deps = makeDeps({ zoomReset: () => called++ });
    await dispatchMenuAction({ action: VIEW_ZOOM_RESET_ACTION }, deps);
    expect(called).toBe(1);
  });

  test("未知 action は何もしない (例外を投げない)", async () => {
    const deps = makeDeps();
    await dispatchMenuAction({ action: "unknown:action" }, deps);
  });

  test("file:open-recent-item → fileExists:true なら openMarkdownFile を呼ぶ", async () => {
    const opened: string[] = [];
    const removed: string[] = [];
    const deps = makeDeps({
      openMarkdownFile: (p) => opened.push(p),
      removeRecentFile: (p) => removed.push(p),
      fileExists: () => true,
    });
    await dispatchMenuAction(
      { action: FILE_OPEN_RECENT_ITEM_ACTION, data: { path: "/x.md" } },
      deps,
    );
    expect(opened).toEqual(["/x.md"]);
    expect(removed).toEqual([]);
  });

  test("file:open-recent-item で data が不正なら何もしない", async () => {
    const opened: string[] = [];
    const removed: string[] = [];
    const deps = makeDeps({
      openMarkdownFile: (p) => opened.push(p),
      removeRecentFile: (p) => removed.push(p),
    });
    await dispatchMenuAction(
      { action: FILE_OPEN_RECENT_ITEM_ACTION, data: {} },
      deps,
    );
    expect(opened).toEqual([]);
    expect(removed).toEqual([]);
  });

  test("file:open-recent-item で fileExists:false なら removeRecentFile を呼び openMarkdownFile は呼ばない", async () => {
    const opened: string[] = [];
    const removed: string[] = [];
    const deps = makeDeps({
      openMarkdownFile: (p) => opened.push(p),
      removeRecentFile: (p) => removed.push(p),
      fileExists: () => false,
    });
    await dispatchMenuAction(
      { action: FILE_OPEN_RECENT_ITEM_ACTION, data: { path: "/missing.md" } },
      deps,
    );
    expect(opened).toEqual([]);
    expect(removed).toEqual(["/missing.md"]);
  });

  test("file:clear-recent → deps.clearRecentFiles を呼ぶ", async () => {
    let cleared = 0;
    const deps = makeDeps({ clearRecentFiles: () => cleared++ });
    await dispatchMenuAction({ action: FILE_CLEAR_RECENT_ACTION }, deps);
    expect(cleared).toBe(1);
  });

  test("file:open-recent (親項目) は何もしない", async () => {
    const opened: string[] = [];
    const cleared: number[] = [];
    const removed: string[] = [];
    const deps = makeDeps({
      openMarkdownFile: (p) => opened.push(p),
      clearRecentFiles: () => cleared.push(1),
      removeRecentFile: (p) => removed.push(p),
    });
    await dispatchMenuAction({ action: FILE_OPEN_RECENT_ACTION }, deps);
    expect(opened).toEqual([]);
    expect(cleared).toEqual([]);
    expect(removed).toEqual([]);
  });
});
