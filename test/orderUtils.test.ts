import { describe, test, expect } from "vitest";
import {
    parseOrder,
    formatOrder,
    compareOrders,
    normalizeOrders,
    resolveDuplicateOrders,
    sortByOrder,
    isValidOrderFormat,
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

describe("isValidOrderFormat", () => {
    test("整数は有効", () => {
        expect(isValidOrderFormat("1")).toBe(true);
        expect(isValidOrderFormat("10")).toBe(true);
        expect(isValidOrderFormat("0")).toBe(true);
    });

    test("ハイフン区切りの階層構造は有効", () => {
        expect(isValidOrderFormat("1-1")).toBe(true);
        expect(isValidOrderFormat("1-2-3")).toBe(true);
    });

    test("小数は有効", () => {
        expect(isValidOrderFormat("1.5")).toBe(true);
        expect(isValidOrderFormat("1-2.5")).toBe(true);
    });

    test("空文字列は無効", () => {
        expect(isValidOrderFormat("")).toBe(false);
    });

    test("数値でない文字列は無効", () => {
        expect(isValidOrderFormat("abc")).toBe(false);
        expect(isValidOrderFormat("1abc")).toBe(false);
        expect(isValidOrderFormat("abc-1")).toBe(false);
    });

    test("負の数は無効(ハイフンは区切り文字のため)", () => {
        expect(isValidOrderFormat("-1")).toBe(false);
        expect(isValidOrderFormat("1--2")).toBe(false);
    });

    test("空セグメントを含む場合は無効", () => {
        expect(isValidOrderFormat("1-")).toBe(false);
        expect(isValidOrderFormat("-1-2")).toBe(false);
        expect(isValidOrderFormat("1--2")).toBe(false);
    });

    test("小数点のみ・不完全な小数は無効", () => {
        expect(isValidOrderFormat("1.")).toBe(false);
        expect(isValidOrderFormat(".5")).toBe(false);
        expect(isValidOrderFormat("1.2.3")).toBe(false);
    });

    test("parseFloatがInfinityになる巨大数字列は無効", () => {
        const huge = "9".repeat(400); // parseFloat(huge) === Infinity
        expect(isValidOrderFormat(huge)).toBe(false);
        expect(isValidOrderFormat(`1-${huge}`)).toBe(false);
        // 通常の桁数の数字列は有効のまま
        expect(isValidOrderFormat("999999999")).toBe(true);
    });

    test("Number.MAX_VALUEに等しいセグメントは無効(次の表現可能値がInfinity)", () => {
        // 17976931348623157e292 は parseFloat すると Number.MAX_VALUE。
        // 有限だが nextUp(MAX_VALUE) は Infinity を返し、重複解消の
        // 割り当てループが停止しななくなるため無効とする
        const maxValueDigits = "17976931348623157" + "0".repeat(292);
        expect(parseFloat(maxValueDigits)).toBe(Number.MAX_VALUE);
        expect(isValidOrderFormat(maxValueDigits)).toBe(false);
        expect(isValidOrderFormat(`1-${maxValueDigits}`)).toBe(false);
        // MAX_VALUE 未満の巨大値は有効のまま
        expect(isValidOrderFormat("1" + "0".repeat(308))).toBe(true); // 1e308
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

describe("resolveDuplicateOrders", () => {
    test("重複が無ければ入力をそのまま返す", () => {
        const input = ["1", "2", "3"];
        const result = resolveDuplicateOrders(input, [-1, -1, -1]);
        expect(result).toEqual(["1", "2", "3"]);
    });

    test("単純な重複2件、priorityが高い方が元の値を保持する", () => {
        // index0="1"(prio -1), index1="1"(prio 5) -> index1が勝者
        const result = resolveDuplicateOrders(["1", "1"], [-1, 5]);
        expect(result[1]).toBe("1");
        expect(result[0]).not.toBe("1");
        // 敗者は勝者(1)と次の既存値(無いので1+1=2)の間に収まる
        expect(Number(result[0])).toBeGreaterThan(1);
        expect(Number(result[0])).toBeLessThan(2);

        // normalizeOrders に通すと重複なく分離される
        const normalized = normalizeOrders(result);
        expect(new Set(normalized)).toEqual(new Set(["1", "2"]));
        expect(normalized[1]).toBe("1"); // 勝者が希望通り1を得る
    });

    test("重複3件以上でも、priority順に段階的にオフセットされ最終的に連番として分離される", () => {
        // index2(prio 9) > index0(prio 3) > index1(prio -1)
        const input = ["1", "1", "1"];
        const priorities = [3, -1, 9];
        const resolved = resolveDuplicateOrders(input, priorities);
        expect(new Set(resolved).size).toBe(3); // 全て別の値になっている

        const normalized = normalizeOrders(resolved);
        expect(new Set(normalized)).toEqual(new Set(["1", "2", "3"]));
        // priorityが最も高いindex2が"1"を獲得する
        expect(normalized[2]).toBe("1");
    });

    test("全員priority未設定(-1)の場合、元の配列インデックスが早い方が勝つ", () => {
        const result = resolveDuplicateOrders(["1", "1"], [-1, -1]);
        expect(result[0]).toBe("1"); // インデックスが早い方が勝者
        expect(result[1]).not.toBe("1");
    });

    test("階層構造での重複でも最後のセグメントのみがオフセットされる", () => {
        const result = resolveDuplicateOrders(["1-2", "1-2"], [-1, 7]);
        expect(result[1]).toBe("1-2"); // 勝者
        expect(result[0]).toMatch(/^1-2\./); // 親("1")は維持され、最後のセグメントのみ変化
    });

    test("null/undefinedはグループ化対象外でそのまま返される", () => {
        const result = resolveDuplicateOrders(["1", null, "1", undefined], [-1, -1, 5, -1]);
        expect(result[1]).toBeNull();
        expect(result[3]).toBeUndefined();
    });

    test("非有限セグメント(Infinity)を含むorderは重複解消の対象外になりハングしない", () => {
        // "9"x400 は parseFloat すると Infinity。重複"1"の次の既存値が
        // Infinity になると、nextUp(Infinity) が Infinity を返し続けて
        // while ループが終了しない（保存操作のハング）ため、これを除外する
        const huge = "9".repeat(400);
        const input = ["1", "1", huge];
        const result = resolveDuplicateOrders(input, [-1, 5, -1]);
        // 巨大数字列のエントリはそのまま、重複"1"は解消される
        expect(result[2]).toBe(huge);
        expect(result[1]).toBe("1"); // 勝者
        expect(Number(result[0])).toBeGreaterThan(1);
        expect(Number(result[0])).toBeLessThan(2);
    });

    test("successorがInfinityになる値(MAX_VALUE)の重複は解消を断念してハングしない", () => {
        // Number.MAX_VALUE は有限のため、入力検証を通過した既存データ・
        // インポート経由で入りうる値。winnerLast + 1 が丸めで winnerLast の
        // ままになり、敗者の割り当てが nextUp(MAX_VALUE) = Infinity に到達、
        // 以降 nextUp(Infinity) が Infinity を返し続けて永久ループする。
        // 割り当て可能な有限値の枯渇は断念（元の値のまま）で打ち切る
        const maxValueDigits = "17976931348623157" + "0".repeat(292);
        const input = [maxValueDigits, maxValueDigits, maxValueDigits];
        const result = resolveDuplicateOrders(input, [-1, 5, -1]);
        // 割り当てられない敗者は元の値のまま（Infinity を含む order は生成されない）
        expect(result).toEqual(input);
        expect(result.every((o) => o == null || !o.includes("Infinity"))).toBe(true);
    });

    test("resolveDuplicateOrders -> normalizeOrders で最終的に重複の無い連番になる(end-to-end)", () => {
        const input = ["1", "1", "2"];
        const priorities = [-1, 8, -1];
        const resolved = resolveDuplicateOrders(input, priorities);
        const normalized = normalizeOrders(resolved);
        expect(new Set(normalized)).toEqual(new Set(["1", "2", "3"]));
        expect(normalized[1]).toBe("1"); // 勝者(index1)が1を獲得
    });

    test("クロスグループ衝突: 2つの重複グループが隣接していても互いに衝突しない", () => {
        // "1"グループ(index0,1)と"1.5"グループ(index2,3)が隣接
        const input = ["1", "1", "1.5", "1.5"];
        const priorities = [-1, 5, -1, 7];
        const resolved = resolveDuplicateOrders(input, priorities);
        // resolveDuplicateOrders自体の出力段階で重複が無いこと
        const nonNull = resolved.filter((v): v is string => v != null);
        expect(new Set(nonNull).size).toBe(nonNull.length);

        const normalized = normalizeOrders(resolved);
        const normalizedNonNull = normalized.filter((v): v is string => v != null);
        expect(new Set(normalizedNonNull).size).toBe(normalizedNonNull.length);
        expect(normalized[1]).toBe("1"); // "1"グループの勝者
        expect(normalized[3]).toBe("3"); // "1.5"グループの勝者(全体で3番目)
    });

    test("クロスグループ衝突: 敗者のオフセットが既存の単独値と衝突しない", () => {
        // "1"の重複を解消するオフセットが、単独で存在する"1.5"と衝突しないこと
        const input = ["1", "1", "1.5"];
        const priorities = [-1, 5, -1];
        const resolved = resolveDuplicateOrders(input, priorities);
        expect(resolved[2]).toBe("1.5"); // 単独値は変化しない
        expect(resolved[0]).not.toBe("1.5"); // 敗者のオフセットが衝突していない

        const normalized = normalizeOrders(resolved);
        const nonNull = normalized.filter((v): v is string => v != null);
        expect(new Set(nonNull).size).toBe(nonNull.length);
    });

    test("階層構造+孫がいる複合エッジケース: クラッシュせず勝者と敗者の相対順序が保たれる", () => {
        // "1-2"が2件重複しており、別タスクが"1-2-1"を持つ
        const input = ["1-2", "1-2", "1-2-1"];
        const priorities = [-1, 7, -1];
        expect(() => {
            const resolved = resolveDuplicateOrders(input, priorities);
            normalizeOrders(resolved);
        }).not.toThrow();

        const resolved = resolveDuplicateOrders(input, priorities);
        const normalized = normalizeOrders(resolved);
        const nonNull = normalized.filter((v): v is string => v != null);
        expect(new Set(nonNull).size).toBe(nonNull.length); // 重複が無い
        // 勝者(index1)が敗者(index0)より前(小さい)順序になる
        expect(compareOrders(normalized[1], normalized[0])).toBeLessThan(0);
    });

    test("間隔がulp級の高精度orderでも丸めにより重複が残らない", () => {
        // 1.0000000000000002 は 1 の次の表現可能値で、その間に中間値は存在しない。
        // 均等分割 1 + 1.11e-16 は 1 へ丸め込まれるため、nextUp 相当の補正が必要。
        const next = 1.0000000000000002;
        const input = ["1", "1", String(next)];
        const priorities = [-1, 5, -1];
        const resolved = resolveDuplicateOrders(input, priorities);
        const nonNull = resolved.filter((v): v is string => v != null);
        expect(new Set(nonNull).size).toBe(nonNull.length); // 出力段階で重複なし

        const normalized = normalizeOrders(resolved);
        const normalizedNonNull = normalized.filter((v): v is string => v != null);
        expect(new Set(normalizedNonNull).size).toBe(normalizedNonNull.length);
        expect(normalized[1]).toBe("1"); // 勝者が1を保持
    });

    test("間隔がulp級でも敗者が複数なら全員distinctな値に分離される", () => {
        const next = 1.0000000000000002;
        const input = ["1", "1", "1", String(next)];
        const priorities = [-1, 3, 5, -1];
        const resolved = resolveDuplicateOrders(input, priorities);
        const nonNull = resolved.filter((v): v is string => v != null);
        expect(new Set(nonNull).size).toBe(nonNull.length);

        const normalized = normalizeOrders(resolved);
        const normalizedNonNull = normalized.filter((v): v is string => v != null);
        expect(new Set(normalizedNonNull)).toEqual(new Set(["1", "2", "3", "4"]));
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
