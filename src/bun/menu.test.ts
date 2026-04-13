/**
 * menu.ts のユニットテスト
 *
 * buildApplicationMenu（純粋関数）の構造検証と
 * dispatchMenuAction（クリックディスパッチ）の挙動検証を行う。
 */

import { describe, expect, test } from "bun:test";
import {
  APP_MENU_LABEL,
  FILE_MENU_LABEL,
  WINDOW_MENU_LABEL,
  FILE_OPEN_ACTION,
  FILE_OPEN_RECENT_ACTION,
  APP_PREFERENCES_ACTION,
  WINDOW_FOCUS_ACTION,
  ACCELERATOR_QUIT,
  ACCELERATOR_HIDE,
  ACCELERATOR_HIDE_OTHERS,
  ACCELERATOR_PREFERENCES,
  ACCELERATOR_OPEN,
  ACCELERATOR_CLOSE,
  ACCELERATOR_MINIMIZE,
  buildApplicationMenu,
  dispatchMenuAction,
} from "./menu";
import type { MenuDeps, MenuClickEvent } from "./menu";

function makeDeps(overrides: Partial<MenuDeps> = {}): MenuDeps {
  return {
    openMarkdownFile: () => {},
    listWindows: () => [],
    focusWindowById: () => {},
    openFileDialog: async () => [],
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
  test("3 つのトップレベルメニュー (mado / File / Window) を返す", () => {
    const menu = buildApplicationMenu(makeDeps());
    expect(menu).toHaveLength(3);
    assertNormal(menu[0]!);
    assertNormal(menu[1]!);
    assertNormal(menu[2]!);
    expect((menu[0] as { label?: string }).label).toBe(APP_MENU_LABEL);
    expect((menu[1] as { label?: string }).label).toBe(FILE_MENU_LABEL);
    expect((menu[2] as { label?: string }).label).toBe(WINDOW_MENU_LABEL);
  });

  test("Application メニューに role:quit + Cmd+Q accelerator がある", () => {
    const menu = buildApplicationMenu(makeDeps());
    const app = menu[0] as { submenu?: MenuItem[] };
    expect(app.submenu).toBeDefined();
    const quit = findByRole(app.submenu!, "quit");
    expect(quit).toBeDefined();
    expect((quit as { accelerator?: string }).accelerator).toBe(ACCELERATOR_QUIT);
  });

  test("Application メニューに about / hide / hideOthers / showAll の role 項目が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps());
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
    const menu = buildApplicationMenu(makeDeps());
    const app = menu[0] as { submenu?: MenuItem[] };
    const pref = app.submenu!.find(
      (i) => (i as { action?: string }).action === APP_PREFERENCES_ACTION,
    );
    expect(pref).toBeDefined();
    expect((pref as { enabled?: boolean }).enabled).toBe(false);
    expect((pref as { accelerator?: string }).accelerator).toBe(ACCELERATOR_PREFERENCES);
  });

  test("File メニューの Open... に file:open + Cmd+O が設定される", () => {
    const menu = buildApplicationMenu(makeDeps());
    const file = menu[1] as { submenu?: MenuItem[] };
    const open = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_ACTION,
    );
    expect(open).toBeDefined();
    expect((open as { accelerator?: string }).accelerator).toBe(ACCELERATOR_OPEN);
    expect((open as { enabled?: boolean }).enabled).not.toBe(false);
  });

  test("File メニューの Open Recent は enabled:false で空 submenu を持つ", () => {
    const menu = buildApplicationMenu(makeDeps());
    const file = menu[1] as { submenu?: MenuItem[] };
    const recent = file.submenu!.find(
      (i) => (i as { action?: string }).action === FILE_OPEN_RECENT_ACTION,
    );
    expect(recent).toBeDefined();
    expect((recent as { enabled?: boolean }).enabled).toBe(false);
    expect((recent as { submenu?: MenuItem[] }).submenu).toEqual([]);
  });

  test("File メニューに role:close + Cmd+W が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps());
    const file = menu[1] as { submenu?: MenuItem[] };
    const close = findByRole(file.submenu!, "close");
    expect(close).toBeDefined();
    expect((close as { accelerator?: string }).accelerator).toBe(ACCELERATOR_CLOSE);
  });

  test("Window メニューに minimize / zoom / bringAllToFront の role が含まれる", () => {
    const menu = buildApplicationMenu(makeDeps());
    const win = menu[2] as { submenu?: MenuItem[] };
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
    const menu = buildApplicationMenu(deps);
    const win = menu[2] as { submenu?: MenuItem[] };
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
    const menu = buildApplicationMenu(makeDeps());
    const win = menu[2] as { submenu?: MenuItem[] };
    const dynamicItems = win.submenu!.filter(
      (i) => (i as { action?: string }).action === WINDOW_FOCUS_ACTION,
    );
    expect(dynamicItems).toHaveLength(0);
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

  test("未知 action は何もしない (例外を投げない)", async () => {
    const deps = makeDeps();
    await dispatchMenuAction({ action: "unknown:action" }, deps);
  });
});
