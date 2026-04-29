/**
 * find.ts の DOM 連携層に対する性質テスト (T045)。
 *
 * happy-dom 上で `#content` に既知の HTML を流し込み、updateSearch を呼んで
 * `state.ranges` が指す実テキストと query が一致するか・件数が一貫しているか・
 * 再検索で前の query のハイライト残留が起きないか を検証する。
 *
 * CSS Custom Highlight API は happy-dom 未サポートのため、`Highlight` と
 * `CSS.highlights` を最小限モックし、Range レベルで検証する。
 *
 * Range の textContent 一致は `r.startContainer.nodeValue.slice(r.startOffset, r.endOffset)`
 * で検証する（`Range.prototype.toString()` の happy-dom 実装齟齬対策、plan §8-1）。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

interface MockHighlight {
  readonly _ranges: Set<Range>;
  add(r: Range): MockHighlight;
  clear(): void;
  delete(r: Range): boolean;
  readonly size: number;
  [Symbol.iterator](): IterableIterator<Range>;
}

const registry = new Map<string, MockHighlight>();
const callCounts = {
  delete: 0,
  set: 0,
  highlightConstructed: 0,
  highlightAdd: 0,
  highlightClear: 0,
};

function makeHighlight(initial: ReadonlyArray<Range>): MockHighlight {
  const ranges = new Set<Range>(initial);
  const hi: MockHighlight = {
    _ranges: ranges,
    add(r: Range): MockHighlight {
      ranges.add(r);
      callCounts.highlightAdd++;
      return hi;
    },
    clear(): void {
      ranges.clear();
      callCounts.highlightClear++;
    },
    delete(r: Range): boolean {
      return ranges.delete(r);
    },
    get size(): number {
      return ranges.size;
    },
    [Symbol.iterator](): IterableIterator<Range> {
      return ranges.values();
    },
  };
  return hi;
}

beforeAll((): void => {
  // happy-dom の正規グローバル登録パスを使用（closest 等の内部 SyntaxError 解決のため）
  GlobalRegistrator.register();

  // CSS Custom Highlight API のモック（happy-dom 未サポート）
  const HighlightCtor = function (this: MockHighlight, ...ranges: Range[]): MockHighlight {
    callCounts.highlightConstructed++;
    return makeHighlight(ranges);
  } as unknown as typeof Highlight;
  Object.defineProperty(globalThis, "Highlight", {
    value: HighlightCtor,
    writable: true,
    configurable: true,
  });

  interface HighlightsMock {
    set(name: string, hi: MockHighlight): HighlightsMock;
    delete(name: string): boolean;
    has(name: string): boolean;
    get(name: string): MockHighlight | undefined;
    clear(): void;
    readonly size: number;
    forEach(cb: (v: MockHighlight, k: string) => void): void;
  }
  const highlightsMock: HighlightsMock = {
    set(name: string, hi: MockHighlight): HighlightsMock {
      registry.set(name, hi);
      callCounts.set++;
      return highlightsMock;
    },
    delete(name: string): boolean {
      callCounts.delete++;
      return registry.delete(name);
    },
    has(name: string): boolean {
      return registry.has(name);
    },
    get(name: string): MockHighlight | undefined {
      return registry.get(name);
    },
    clear(): void {
      registry.clear();
    },
    get size(): number {
      return registry.size;
    },
    forEach(cb: (v: MockHighlight, k: string) => void): void {
      registry.forEach(cb);
    },
  };
  // happy-dom が CSS を read-only で設定するため、defineProperty で上書きする
  Object.defineProperty(globalThis, "CSS", {
    value: { highlights: highlightsMock } as unknown as typeof CSS,
    writable: true,
    configurable: true,
  });
});

afterAll(async (): Promise<void> => {
  registry.clear();
  await GlobalRegistrator.unregister();
});

beforeEach((): void => {
  registry.clear();
  callCounts.delete = 0;
  callCounts.set = 0;
  callCounts.highlightConstructed = 0;
  callCounts.highlightAdd = 0;
  callCounts.highlightClear = 0;
});

// 動的 import: グローバル DOM/CSS を beforeAll 後に find.ts を import するため
// import 文ではなく動的 import を使う
async function loadFindModule(): Promise<typeof import("../find")> {
  return await import("../find");
}

function setupContent(html: string): HTMLElement {
  document.body.innerHTML = `<article id="content">${html}</article>`;
  const content = document.getElementById("content");
  if (!content) throw new Error("setup failed: #content not found");
  return content as HTMLElement;
}

function rangeText(r: Range): string {
  const sc = r.startContainer;
  const v = sc.nodeValue ?? "";
  return v.slice(r.startOffset, r.endOffset);
}

describe("updateSearch — Range textContent と query の一致 (Test 1)", () => {
  test("ハイライト Range の slice 結果が query と完全一致する", async () => {
    const { __test__ } = await loadFindModule();
    setupContent(
      "<p>Markdown editors are everywhere — but <code>everyday</code> tools.</p>",
    );

    __test__.updateSearch("every");

    // every は "everywhere" の "every" + "everyday" の "every" の 2 箇所
    expect(__test__.state.ranges.length).toBe(2);

    // 各 Range の slice が "every" と一致することを確認（toString 非依存）
    for (const r of __test__.state.ranges) {
      expect(rangeText(r).toLowerCase()).toBe("every");
    }

    // 結合しても "every".repeat(2) になる
    const joined = __test__.state.ranges.map((r) => rangeText(r)).join("");
    expect(joined.toLowerCase()).toBe("every".repeat(2));
  });

  test("複数テキストノードを跨ぐマッチでも各 slice が query と一致する", async () => {
    const { __test__ } = await loadFindModule();
    setupContent(
      "<p>foo <strong>bar</strong> baz <em>foo</em> qux</p>",
    );

    __test__.updateSearch("foo");

    expect(__test__.state.ranges.length).toBe(2);
    for (const r of __test__.state.ranges) {
      expect(rangeText(r).toLowerCase()).toBe("foo");
    }
  });
});

describe("updateSearch — 件数一貫性 (Test 2)", () => {
  test("state.ranges.length と #find-count の表示が一致する", async () => {
    const { __test__ } = await loadFindModule();
    document.body.innerHTML = `
      <article id="content"><p>every every every every every every every</p></article>
      <span id="find-count"></span>
    `;

    __test__.updateSearch("every");

    expect(__test__.state.ranges.length).toBe(7);
    const countEl = document.getElementById("find-count");
    expect(countEl?.textContent).toBe("1 / 7");
  });

  test("MAX_MATCHES (5000) を超える本文では '5000+' 表記になる", async () => {
    const { __test__ } = await loadFindModule();
    // "a" を 6000 個並べる -> ranges.length は 5000 で打ち切り
    document.body.innerHTML = `
      <article id="content"><p>${"a".repeat(6000)}</p></article>
      <span id="find-count"></span>
    `;

    __test__.updateSearch("a");

    expect(__test__.state.ranges.length).toBe(__test__.MAX_MATCHES);
    const countEl = document.getElementById("find-count");
    expect(countEl?.textContent).toBe(`1 / ${__test__.MAX_MATCHES}+`);
  });
});

describe("updateSearch — mutation / 再検索 / details (Test 3)", () => {
  test("innerHTML 差し替え後 resetFind() で state とハイライトがクリアされる", async () => {
    const { __test__ } = await loadFindModule();
    document.body.innerHTML = `
      <article id="content"><p>every every</p></article>
      <span id="find-count"></span>
      <input id="find-input" type="text" />
      <div id="find-box"></div>
    `;

    __test__.updateSearch("every");
    expect(__test__.state.ranges.length).toBe(2);

    const content = document.getElementById("content");
    if (!content) throw new Error("content not found");
    content.innerHTML = "<p>different content</p>";

    __test__.resetFind();

    expect(__test__.state.ranges).toEqual([]);
    expect(__test__.state.query).toBe("");
    expect(__test__.state.isOpen).toBe(false);
    // T045 修正: singleton Highlight を再利用するため registry には name が残るが、
    // 中身の Range が 0 件になっていれば描画上は何も表示されない（仕様準拠）。
    const hi = registry.get(__test__.HIGHLIGHT_ALL);
    if (hi) {
      expect([...hi].length).toBe(0);
    }
  });

  test("検索 → 再検索 で前の query のハイライトが残らない (回帰テスト本丸)", async () => {
    const { __test__ } = await loadFindModule();
    setupContent(
      // every の短いマッチが多い + everywhere は 1 箇所だけ
      "<p>every everyone everyday everywhere — and Markdown viewers Electrobun Mermaid.</p>",
    );

    // 1. 短い query で多数マッチ
    __test__.updateSearch("every");
    const everyCount = __test__.state.ranges.length;
    expect(everyCount).toBeGreaterThanOrEqual(4); // every / everyone / everyday / everywhere の "every"
    const hiAfterEvery = registry.get(__test__.HIGHLIGHT_ALL);
    expect(hiAfterEvery).toBeDefined();

    // 2. 長い query で唯一マッチに切り替え
    __test__.updateSearch("everywhere");

    // state.ranges は "everywhere" 1 件のみ
    expect(__test__.state.ranges.length).toBe(1);
    for (const r of __test__.state.ranges) {
      expect(rangeText(r).toLowerCase()).toBe("everywhere");
    }

    // ★本丸: CSS.highlights[HIGHLIGHT_ALL] には "everywhere" 以外の Range が
    //   1 件も残らない（happy-dom 上の論理検証 — WebKit の表示残留は実機で別途確認）
    const hiAfterEverywhere = registry.get(__test__.HIGHLIGHT_ALL);
    expect(hiAfterEverywhere).toBeDefined();
    if (!hiAfterEverywhere) return;
    const hiRanges = [...hiAfterEverywhere];
    expect(hiRanges.length).toBe(1);
    for (const r of hiRanges) {
      expect(rangeText(r).toLowerCase()).toBe("everywhere");
    }

    // ★ singleton-identity 表明: 修正後は同一の Highlight インスタンスを clear() + add() で
    //   再利用するため、CSS.highlights.delete(name) → set(name, new Highlight(...)) という
    //   WebKit 描画キャッシュ残留の原因となるパターンを取らないことを保証する。
    //   修正前のコードはこの表明で fail する（毎回 new Highlight を生成して set し直すため）。
    expect(hiAfterEvery).toBeDefined();
    if (!hiAfterEvery) return;
    expect(hiAfterEverywhere).toBe(hiAfterEvery);

    // 3. 段階的縮小: everywhere → every → 空 で残留が起きないことも確認
    __test__.updateSearch("every");
    {
      const hi2 = registry.get(__test__.HIGHLIGHT_ALL);
      expect(hi2).toBeDefined();
      if (!hi2) return;
      // 同じ Highlight インスタンスのままであり続ける
      expect(hi2).toBe(hiAfterEvery);
      for (const r of [...hi2]) {
        expect(rangeText(r).toLowerCase()).toBe("every");
      }
    }
    __test__.updateSearch("");
    expect(__test__.state.ranges).toEqual([]);
    // 空 query 時は singleton を空にする（registry から消すか、空のまま残すかは実装裁量）
    const hiAfterEmpty = registry.get(__test__.HIGHLIGHT_ALL);
    if (hiAfterEmpty) {
      expect([...hiAfterEmpty].length).toBe(0);
    }
  });

  test("details の open/close を跨いでも Range の指すテキストが query と一致する", async () => {
    const { __test__ } = await loadFindModule();
    setupContent(
      "<details><summary>S</summary><p>everyday tooling</p></details>",
    );
    const det = document.querySelector("details") as HTMLDetailsElement | null;
    if (!det) throw new Error("details not found");

    // details が閉じた状態でも TreeWalker は中身を拾える
    det.open = false;
    __test__.updateSearch("every");
    expect(__test__.state.ranges.length).toBe(1);
    expect(rangeText(__test__.state.ranges[0]!).toLowerCase()).toBe("every");

    // details を開いても Range の指す位置は変わらない
    det.open = true;
    expect(rangeText(__test__.state.ranges[0]!).toLowerCase()).toBe("every");
  });
});
