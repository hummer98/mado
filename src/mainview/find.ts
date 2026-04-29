/**
 * ページ内検索 (⌘F) の実装 (T043)。
 *
 * `.markdown-body` (#content) 内のテキストノードを TreeWalker で走査し、
 * CSS Custom Highlight API (`CSS.highlights`) を使って DOM 非破壊で
 * マッチをハイライトする。
 *
 * - メニュー > Edit > Find... → __MADO_SHOW_FIND__() で起動
 * - 入力 → デバウンス → ハイライト更新
 * - Enter / ↓ で次へ、Shift+Enter / ↑ で前へ
 * - 現在マッチは別 Highlight (mado-find-current) で重ね掛け
 * - ESC で閉じてハイライト除去
 *
 * CLAUDE.md 規約:
 * - 全関数の戻り値型は明示する
 * - `as` キャストは最終手段。型ガードを優先
 * - any 禁止。`unknown` で受けて型ガードで絞る
 */

// TS lib.dom.d.ts に Highlight 型が無い環境への保険。標準 (Highlight extends Set<AbstractRange>) と互換のシグネチャ。
declare class Highlight {
  constructor(...ranges: Range[]);
  add(range: Range): Highlight;
  clear(): void;
  delete(range: Range): boolean;
  readonly size: number;
}

// 現行の TS lib.dom.d.ts は HighlightRegistry に forEach しか定義していないため、
// declaration merging で set / delete を追加して Map 互換に拡張する。
// これにより `CSS.highlights.set("name", hi)` / `.delete("name")` を
// `as` キャスト無しで型安全に呼べる（CLAUDE.md「as は最終手段」準拠）。
declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): HighlightRegistry;
    delete(name: string): boolean;
    has(name: string): boolean;
    clear(): void;
    readonly size: number;
  }
}

const HIGHLIGHT_ALL = "mado-find-all";
const HIGHLIGHT_CURRENT = "mado-find-current";
const DEBOUNCE_MS = 100;
const MAX_MATCHES = 5000;

/** WebView 内に流し込まれる locale (Bun 側で resolveLocale → ja|en) */
type FindLocale = "en" | "ja";

interface FindState {
  query: string;
  ranges: Range[];
  currentIndex: number;
  isOpen: boolean;
  locale: FindLocale;
}

const state: FindState = {
  query: "",
  ranges: [],
  currentIndex: -1,
  isOpen: false,
  locale: "en",
};

let debounceTimer: number | null = null;

// T045: ハイライト残留対策で同一 Highlight インスタンスを使い回す。
// `CSS.highlights.delete(name)` → `set(name, new Highlight(...))` の rapid pattern を取ると
// WebKit の描画キャッシュが前世代の Range を保持して残留ハイライトとなる挙動が観測されたため、
// 「同じインスタンスを registry に登録したまま `clear()` + `add()` で内容のみ更新する」方針に切り替え。
let allHighlight: Highlight | null = null;
let currentHighlight: Highlight | null = null;

const FIND_LABELS = {
  en: {
    input: "Find",
    prev: "Previous match",
    next: "Next match",
    close: "Close (ESC)",
  },
  ja: {
    input: "検索ワード",
    prev: "前のマッチ",
    next: "次のマッチ",
    close: "閉じる (ESC)",
  },
} as const;

// --- 純粋ロジック (bun:test 対象) ---

/** findRanges の入力レコード（テストでは {value} のみで足りる） */
export interface FindRangeInput {
  value: string;
}

/** findRanges の出力レコード */
export interface FindRangeMatch {
  nodeIndex: number;
  start: number;
  end: number;
}

/**
 * クエリと textNodes 風の入力から match レコード配列を生成する。
 *
 * `Range` オブジェクトを直接作らず `{nodeIndex, start, end}` を返すことで
 * bun:test で DOM 不要に検証できる。実 DOM 用には呼び出し側で
 * このレコードと `Text[]` を組み合わせて Range を構築する。
 *
 * - 空クエリ → 空配列
 * - case-insensitive (options.caseInsensitive=true 時)
 * - ノードを跨ぐマッチは検出しない（仕様）
 * - options.max を超えたら打ち切り
 */
export function findRanges(
  textNodes: ReadonlyArray<FindRangeInput>,
  query: string,
  options: { caseInsensitive: boolean; max: number },
): FindRangeMatch[] {
  if (query.length === 0) return [];
  const needle = options.caseInsensitive ? query.toLowerCase() : query;
  const result: FindRangeMatch[] = [];

  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    if (!node) continue;
    const value = node.value;
    const haystack = options.caseInsensitive ? value.toLowerCase() : value;
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      result.push({ nodeIndex: i, start: idx, end: idx + query.length });
      if (result.length >= options.max) return result;
      from = idx + Math.max(1, query.length);
    }
  }
  return result;
}

// --- DOM 連携（実 DOM が必要なため bun:test では検証しない） ---

/**
 * `root` 配下のテキストノードを TreeWalker で列挙する。
 *
 * `<pre>` / `<svg>` / `<script>` / `<style>` を祖先に持つテキストは除外する
 * （code block / Mermaid 完成 SVG / hljs 内部 / 不可視は対象外）。
 */
function collectTextNodes(root: Node): Text[] {
  const result: Text[] = [];
  if (typeof document === "undefined") return result;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      let p: Node | null = node.parentNode;
      while (p && p !== root) {
        if (p.nodeType === 1) {
          const tag = (p as Element).tagName;
          if (
            tag === "PRE" ||
            tag === "SVG" ||
            tag === "SCRIPT" ||
            tag === "STYLE"
          ) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    result.push(n as Text);
  }
  return result;
}

/** CSS Custom Highlight API が利用できるかを型ガードで判定 */
function hasHighlightRegistry(): boolean {
  if (typeof CSS === "undefined") return false;
  if (CSS.highlights === undefined) return false;
  return true;
}

function applyHighlights(): void {
  if (!hasHighlightRegistry()) {
    console.warn("[mado] CSS Custom Highlight API unavailable");
    return;
  }

  // 全マッチ用 Highlight: singleton を再利用して clear()+add() で内容更新 (T045)
  if (allHighlight === null) {
    allHighlight = new Highlight();
  } else {
    allHighlight.clear();
  }
  // 防御的: 外部から CSS.highlights が削除された場合に備えて毎回 has を確認して再登録
  if (!CSS.highlights.has(HIGHLIGHT_ALL)) {
    CSS.highlights.set(HIGHLIGHT_ALL, allHighlight);
  }
  for (const r of state.ranges) {
    allHighlight.add(r);
  }

  // 現在マッチ用 Highlight: 同様に singleton 再利用 (T045)
  if (currentHighlight === null) {
    currentHighlight = new Highlight();
  } else {
    currentHighlight.clear();
  }
  if (!CSS.highlights.has(HIGHLIGHT_CURRENT)) {
    CSS.highlights.set(HIGHLIGHT_CURRENT, currentHighlight);
  }
  if (state.currentIndex >= 0 && state.currentIndex < state.ranges.length) {
    const cur = state.ranges[state.currentIndex];
    if (cur) currentHighlight.add(cur);
  }
}

function clearHighlights(): void {
  if (!hasHighlightRegistry()) return;
  // T045: registry から消すと同じ name の delete/set rapid pattern を再現してしまうため、
  // 既に保持している singleton を空にするだけにする。registry に空 Highlight が残っても
  // 描画上は 0 件で何も表示されない（Highlight extends Set の size=0 状態）。
  if (allHighlight !== null) allHighlight.clear();
  if (currentHighlight !== null) currentHighlight.clear();
}

function ensureAncestorsVisible(target: Element): void {
  // <details> 折りたたみ内のマッチに移動する場合は自動展開する
  let cur: Element | null = target;
  while (cur) {
    const det: HTMLDetailsElement | null = cur.closest("details");
    if (!det || det.open) break;
    det.open = true;
    cur = det.parentElement;
  }
}

function scrollToCurrent(): void {
  const r = state.ranges[state.currentIndex];
  if (!r) return;
  const sc = r.startContainer;
  const target = sc.nodeType === 1 ? (sc as Element) : sc.parentElement;
  if (!target) return;
  ensureAncestorsVisible(target);
  target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function updateCount(): void {
  const el = document.getElementById("find-count");
  if (!el) return;
  const total = state.ranges.length;
  if (total === 0) {
    el.textContent = state.query.length === 0 ? "" : "0 / 0";
  } else if (total >= MAX_MATCHES) {
    // 打ち切り時: 分母に + を付けて MAX 到達を示す。ナビゲーションは 0..4999 範囲に閉じる
    el.textContent = `${state.currentIndex + 1} / ${MAX_MATCHES}+`;
  } else {
    el.textContent = `${state.currentIndex + 1} / ${total}`;
  }
}

function navigate(direction: "next" | "prev"): void {
  if (state.ranges.length === 0) return;
  const delta = direction === "next" ? 1 : -1;
  const n = state.ranges.length;
  state.currentIndex = (((state.currentIndex + delta) % n) + n) % n;
  applyHighlights();
  scrollToCurrent();
  updateCount();
  console.log(
    `[mado] find_navigate direction=${direction} index=${state.currentIndex + 1} total=${n}`,
  );
}

function updateSearch(query: string): void {
  state.query = query;
  if (query.length === 0) {
    clearHighlights();
    state.ranges = [];
    state.currentIndex = -1;
    updateCount();
    console.log(`[mado] find_query_changed query_len=0 hits=0`);
    return;
  }
  const root = document.getElementById("content");
  if (!root) return;

  const textNodes = collectTextNodes(root);
  const lowerQuery = query.toLowerCase();
  const ranges: Range[] = [];
  let truncated = false;

  outer: for (const tn of textNodes) {
    const value = tn.nodeValue ?? "";
    const lower = value.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lower.indexOf(lowerQuery, from);
      if (idx < 0) break;
      const r = document.createRange();
      r.setStart(tn, idx);
      r.setEnd(tn, idx + query.length);
      ranges.push(r);
      if (ranges.length >= MAX_MATCHES) {
        truncated = true;
        break outer;
      }
      from = idx + Math.max(1, query.length);
    }
  }

  state.ranges = ranges;
  state.currentIndex = ranges.length > 0 ? 0 : -1;
  applyHighlights();
  updateCount();
  if (state.currentIndex >= 0) scrollToCurrent();
  console.log(
    `[mado] find_query_changed query_len=${query.length} hits=${ranges.length}${truncated ? "+" : ""}`,
  );
  if (truncated) {
    console.log(`[mado] find_max_matches_reached limit=${MAX_MATCHES}`);
  }
}

function showFind(source: "menu" | "shortcut" | "remote"): void {
  const inputEl = document.getElementById("find-input");
  const findBox = document.getElementById("find-box");
  if (!(inputEl instanceof HTMLInputElement) || !findBox) return;

  // 冪等性: 既に開いているなら再フォーカス + 全選択して early return（VS Code 挙動）
  if (state.isOpen) {
    inputEl.focus();
    inputEl.select();
    console.log(`[mado] find_refocused source=${source}`);
    return;
  }

  state.isOpen = true;
  findBox.hidden = false;
  inputEl.focus();
  inputEl.select();
  console.log(`[mado] find_opened source=${source}`);
}

function closeFind(source: "escape" | "button" | "reset"): void {
  // デバウンス中の updateSearch がクローズ後に発火する race を防ぐ
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  state.isOpen = false;
  state.query = "";
  state.ranges = [];
  state.currentIndex = -1;
  clearHighlights();

  const inputEl = document.getElementById("find-input");
  const findBox = document.getElementById("find-box");
  if (inputEl instanceof HTMLInputElement) inputEl.value = "";
  if (findBox) findBox.hidden = true;

  updateCount();
  console.log(`[mado] find_closed source=${source}`);
}

function resetFind(): void {
  // render() 末尾から呼ばれる。既に閉じていてハイライトも無いなら no-op。
  if (!state.isOpen && state.ranges.length === 0) return;
  closeFind("reset");
}

function setLocale(locale: FindLocale): void {
  state.locale = locale;
  const labels = FIND_LABELS[locale];
  const inputEl = document.getElementById("find-input");
  if (inputEl) inputEl.setAttribute("aria-label", labels.input);

  const targets: Array<readonly [string, "prev" | "next" | "close"]> = [
    ["find-prev", "prev"],
    ["find-next", "next"],
    ["find-close", "close"],
  ];
  for (const [id, key] of targets) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute("aria-label", labels[key]);
    el.setAttribute("title", labels[key]);
  }
}

declare global {
  interface Window {
    /** Edit > Find... から executeJavascript で呼び出される (T043) */
    __MADO_SHOW_FIND__: () => void;
    /** render() からハイライトを破棄するために呼ぶ (T043) */
    __MADO_FIND_RESET__: () => void;
    /** メインプロセスから locale を流して検索ボックス内文言を切り替える (T043) */
    __MADO_SET_LOCALE__: (locale: FindLocale) => void;
  }
}

/**
 * テスト専用 export (T045)。bun:test + happy-dom から DOM 連携部分の振る舞いを
 * 性質テストで検証するための名前空間。production コードからは参照しない。
 */
export const __test__ = {
  state,
  updateSearch,
  closeFind,
  resetFind,
  applyHighlights,
  navigate,
  HIGHLIGHT_ALL,
  HIGHLIGHT_CURRENT,
  MAX_MATCHES,
} as const;

/**
 * 検索機能を初期化する。index.ts から DOMContentLoaded 後の同期パスで 1 回だけ呼ぶ。
 * DOM (find-box / find-input / find-prev / find-next / find-close / content) が
 * すでに body に存在する前提（<script type="module"> は body 末尾で同期実行される）。
 */
export function initFind(): void {
  const inputEl = document.getElementById("find-input");
  const prevBtn = document.getElementById("find-prev");
  const nextBtn = document.getElementById("find-next");
  const closeBtn = document.getElementById("find-close");

  if (!(inputEl instanceof HTMLInputElement)) {
    console.warn("[mado] find: find-input element not found");
    return;
  }

  inputEl.addEventListener("input", (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout((): void => {
      debounceTimer = null;
      updateSearch(inputEl.value);
    }, DEBOUNCE_MS);
  });

  inputEl.addEventListener("keydown", (ev: KeyboardEvent): void => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      navigate(ev.shiftKey ? "prev" : "next");
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeFind("escape");
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      navigate("next");
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      navigate("prev");
    }
  });

  if (prevBtn) prevBtn.addEventListener("click", (): void => navigate("prev"));
  if (nextBtn) nextBtn.addEventListener("click", (): void => navigate("next"));
  if (closeBtn) closeBtn.addEventListener("click", (): void => closeFind("button"));

  // WebView 内ショートカット: ⌘F でも起動できるよう document レベルで捕捉する。
  // メインプロセス側のメニュー accelerator が先に消費する想定だが、
  // WebKit のページ内検索 UI と衝突しないよう保険として preventDefault する。
  document.addEventListener("keydown", (ev: KeyboardEvent): void => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      showFind("shortcut");
      return;
    }
    if (ev.key === "Escape" && state.isOpen) {
      ev.preventDefault();
      closeFind("escape");
    }
  });

  window.__MADO_SHOW_FIND__ = (): void => {
    showFind("remote");
  };
  window.__MADO_FIND_RESET__ = (): void => {
    resetFind();
  };
  window.__MADO_SET_LOCALE__ = (locale: FindLocale): void => {
    setLocale(locale);
  };
}
