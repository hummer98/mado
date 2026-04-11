import { describe, it, expect, beforeEach, mock } from "bun:test";
import { debounce } from "../../src/lib/debounce.ts";
import type { Debounced } from "../../src/lib/debounce.ts";

describe("debounce", () => {
  beforeEach(() => {
    // タイマーをリセット
    mock.restore();
  });

  describe("連続呼び出しの抑制", () => {
    it("連続呼び出しで最後の1回だけ実行されること", async () => {
      const fn = mock(() => {});
      const debounced: Debounced<typeof fn> = debounce(fn, 50);

      // 3回連続で呼び出す
      debounced.call();
      debounced.call();
      debounced.call();

      // まだ実行されていない
      expect(fn).toHaveBeenCalledTimes(0);

      // 指定時間の経過を待つ
      await new Promise((resolve) => setTimeout(resolve, 80));

      // 最後の1回だけ実行される
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("最後の呼び出しの引数でコールバックが実行されること", async () => {
      const fn = mock((_value: string) => {});
      const debounced = debounce(fn, 50);

      debounced.call("first");
      debounced.call("second");
      debounced.call("third");

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("third");
    });
  });

  describe("遅延実行", () => {
    it("指定時間経過後にコールバックが呼ばれること", async () => {
      const fn = mock(() => {});
      const debounced = debounce(fn, 50);

      debounced.call();

      // 指定時間前はまだ呼ばれない
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fn).toHaveBeenCalledTimes(0);

      // 指定時間経過後に呼ばれる
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("間隔を空けた呼び出しはそれぞれ実行されること", async () => {
      const fn = mock(() => {});
      const debounced = debounce(fn, 50);

      debounced.call();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(fn).toHaveBeenCalledTimes(1);

      debounced.call();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancel", () => {
    it("未実行のコールバックがキャンセルされること", async () => {
      const fn = mock(() => {});
      const debounced = debounce(fn, 50);

      debounced.call();
      debounced.cancel();

      await new Promise((resolve) => setTimeout(resolve, 80));

      // キャンセルしたので実行されない
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it("キャンセル後に再度呼び出しできること", async () => {
      const fn = mock(() => {});
      const debounced = debounce(fn, 50);

      debounced.call();
      debounced.cancel();

      // キャンセル後に再度呼び出す
      debounced.call();
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("タイマーが設定されていない状態での cancel は安全に動作すること", () => {
      const fn = mock(() => {});
      const debounced = debounce(fn, 50);

      // 何も呼ばずに cancel しても例外が発生しない
      expect(() => debounced.cancel()).not.toThrow();
    });
  });
});
