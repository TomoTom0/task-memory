import { describe, test, expect } from "bun:test";
import {
    parseOrder,
    formatOrder,
    compareOrders,
    normalizeOrders,
    sortByOrder,
} from "../src/utils/orderUtils";

describe("parseOrder", () => {
    test("単一の整数をパースできる", () => {
        expect(parseOrder("1")).toEqual([1]);
        expect(parseOrder("5")).toEqual([5]);
        expect(parseOrder("10")).toEqual([10]);
    });

    test("ハイフン区切りの整数をパースできる", () => {
        expect(parseOrder("1-1")).toEqual([1, 1]);
        expect(parseOrder("1-2-3")).toEqual([1, 2, 3]);
        expect(parseOrder("10-20-30")).toEqual([10, 20, 30]);
    });

    test("小数をパースできる", () => {
        expect(parseOrder("1.5")).toEqual([1.5]);
        expect(parseOrder("1-2.5")).toEqual([1, 2.5]);
        expect(parseOrder("1.5-2.5-3.5")).toEqual([1.5, 2.5, 3.5]);
    });

    test("空文字列は空配列を返す", () => {
        expect(parseOrder("")).toEqual([]);
    });
});

describe("formatOrder", () => {
    test("単一の数値をフォーマットできる", () => {
        expect(formatOrder([1])).toBe("1");
        expect(formatOrder([10])).toBe("10");
    });

    test("複数の数値をハイフンで結合できる", () => {
        expect(formatOrder([1, 1])).toBe("1-1");
        expect(formatOrder([1, 2, 3])).toBe("1-2-3");
    });

    test("空配列は空文字列を返す", () => {
        expect(formatOrder([])).toBe("");
    });
});

describe("compareOrders", () => {
    test("単一の数値を比較できる", () => {
        expect(compareOrders("1", "2")).toBeLessThan(0);
        expect(compareOrders("2", "1")).toBeGreaterThan(0);
        expect(compareOrders("1", "1")).toBe(0);
    });

    test("階層構造を正しく比較できる", () => {
        // 1 < 1-1 < 1-2 < 2
        expect(compareOrders("1", "1-1")).toBeLessThan(0);
        expect(compareOrders("1-1", "1-2")).toBeLessThan(0);
        expect(compareOrders("1-2", "2")).toBeLessThan(0);
    });

    test("深いネストを正しく比較できる", () => {
        // 1 < 1-1 < 1-1-1 < 1-2 < 2
        expect(compareOrders("1", "1-1")).toBeLessThan(0);
        expect(compareOrders("1-1", "1-1-1")).toBeLessThan(0);
        expect(compareOrders("1-1-1", "1-2")).toBeLessThan(0);
        expect(compareOrders("1-2", "2")).toBeLessThan(0);
    });

    test("null は後ろに配置される", () => {
        expect(compareOrders(null, "1")).toBeGreaterThan(0);
        expect(compareOrders("1", null)).toBeLessThan(0);
        expect(compareOrders(null, null)).toBe(0);
    });

    test("undefined は null と同様に扱われる", () => {
        expect(compareOrders(undefined, "1")).toBeGreaterThan(0);
        expect(compareOrders("1", undefined)).toBeLessThan(0);
    });
});

describe("normalizeOrders", () => {
    test("基本的な連番の正規化", () => {
        const input = ["1", "3", "5"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1", "2", "3"]);
    });

    test("階層構造を保持して正規化", () => {
        // 入力: 1, 1-1, 1-3, 2, 3-2
        // 出力: 1, 1-1, 1-2, 2, 3-1
        const input = ["1", "1-1", "1-3", "2", "3-2"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1", "1-1", "1-2", "2", "3-1"]);
    });

    test("孫がいる場合、親番号は使用済みとして確保", () => {
        // 入力: 1, 1-1, 1-2-1, 1-4, 2, 3-2
        // 出力: 1, 1-1, 1-2-1, 1-3, 2, 3-1
        const input = ["1", "1-1", "1-2-1", "1-4", "2", "3-2"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1", "1-1", "1-2-1", "1-3", "2", "3-1"]);
    });

    test("小数入力を正規化", () => {
        // 入力: 1.5, 1, 2
        // ソート後: 1, 1.5, 2 -> 正規化: 1, 2, 3
        // 結果は入力順序を維持: 1.5->2, 1->1, 2->3
        const input = ["1.5", "1", "2"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["2", "1", "3"]);
    });

    test("階層内の小数入力を正規化", () => {
        // 入力: 1-1, 1-1.5, 1-2
        // ソート後: 1-1, 1-1.5, 1-2
        // 出力: 1-1, 1-2, 1-3
        const input = ["1-1", "1-1.5", "1-2"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1-1", "1-2", "1-3"]);
    });

    test("深いネストの正規化", () => {
        // 入力: 1-1-1, 1-1-3
        // 出力: 1-1-1, 1-1-2
        const input = ["1-1-1", "1-1-3"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1-1-1", "1-1-2"]);
    });

    test("null を含む配列の正規化", () => {
        const input = ["2", null, "1", null];
        const result = normalizeOrders(input);
        // null はそのまま null として返される
        expect(result).toEqual(["2", null, "1", null]);
    });

    test("空配列の正規化", () => {
        const result = normalizeOrders([]);
        expect(result).toEqual([]);
    });

    test("単一要素の正規化", () => {
        const result = normalizeOrders(["5"]);
        expect(result).toEqual(["1"]);
    });

    test("複雑なケース: 複数レベルの欠番", () => {
        // 入力: 2, 2-3, 2-3-5, 4
        // 出力: 1, 1-1, 1-1-1, 2
        const input = ["2", "2-3", "2-3-5", "4"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1", "1-1", "1-1-1", "2"]);
    });

    test("暗黙的な親が複数ある場合", () => {
        // 入力: 1-2-1, 1-4-1
        // 1-2 と 1-4 は暗黙的に存在
        // 出力: 1-1-1, 1-2-1
        const input = ["1-2-1", "1-4-1"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1-1-1", "1-2-1"]);
    });

    test("トップレベルがない子要素のみの場合", () => {
        // 入力: 1-1, 2-1
        // 出力: 1-1, 2-1 (トップレベルは暗黙的)
        const input = ["1-1", "2-1"];
        const result = normalizeOrders(input);
        expect(result).toEqual(["1-1", "2-1"]);
    });
});

describe("sortByOrder", () => {
    interface TestTask {
        id: string;
        order: string | null;
    }

    test("order で昇順ソートされる", () => {
        const tasks: TestTask[] = [
            { id: "TASK-1", order: "3" },
            { id: "TASK-2", order: "1" },
            { id: "TASK-3", order: "2" },
        ];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted.map((t) => t.id)).toEqual(["TASK-2", "TASK-3", "TASK-1"]);
    });

    test("階層構造で正しくソートされる", () => {
        const tasks: TestTask[] = [
            { id: "TASK-1", order: "2" },
            { id: "TASK-2", order: "1-1" },
            { id: "TASK-3", order: "1" },
        ];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted.map((t) => t.id)).toEqual(["TASK-3", "TASK-2", "TASK-1"]);
    });

    test("order が null のタスクは後ろに配置される", () => {
        const tasks: TestTask[] = [
            { id: "TASK-1", order: null },
            { id: "TASK-2", order: "1" },
            { id: "TASK-3", order: null },
            { id: "TASK-4", order: "2" },
        ];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted.map((t) => t.id)).toEqual([
            "TASK-2",
            "TASK-4",
            "TASK-1",
            "TASK-3",
        ]);
    });

    test("同一 order の場合は ID 昇順でソートされる", () => {
        const tasks: TestTask[] = [
            { id: "TASK-3", order: "1" },
            { id: "TASK-1", order: "1" },
            { id: "TASK-2", order: "1" },
        ];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted.map((t) => t.id)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    });

    test("null 同士の場合は ID 昇順でソートされる", () => {
        const tasks: TestTask[] = [
            { id: "TASK-3", order: null },
            { id: "TASK-1", order: null },
            { id: "TASK-2", order: null },
        ];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted.map((t) => t.id)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    });

    test("空配列のソート", () => {
        const tasks: TestTask[] = [];
        const sorted = sortByOrder(tasks, (t) => t.order, (t) => t.id);
        expect(sorted).toEqual([]);
    });
});
