import { describe, test, expect } from "vitest";
import {
    parseOrder,
    formatOrder,
    compareOrders,
    normalizeOrders,
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

describe("normalizeOrders: order重複の解消（優先度込み）", () => {
    // 期待値は、置換前の resolveDuplicateOrders() -> normalizeOrders() パイプラインの
    // 出力をリファクタリング前に採取・固定化したもの（TASK-9）。
    // 優先度が最も高い要素（勝者）が元の値の位置を保持し、他の要素（敗者）は
    // 優先度順で勝者と次に大きい既存値の間に配置される。間隔がulp級の高精度orderの
    // 2件のみ、旧実装の浮動小数点丸めによる逸脱（敗者が次の既存値を追い越す）を
    // 修正しており、設計意図どおりの配置を期待値としている。

    test("重複が無ければ従来どおり連番に正規化される", () => {
        expect(normalizeOrders(["1", "2", "3"], [-1, -1, -1])).toEqual(["1", "2", "3"]);
        expect(normalizeOrders(["1", "3", "5"], [-1, -1, -1])).toEqual(["1", "2", "3"]);
        // priorities 省略時も同じ（全要素未設定扱い）
        expect(normalizeOrders(["1", "3", "5"])).toEqual(["1", "2", "3"]);
    });

    test("単純な重複2件、priorityが高い方が元の値を保持する", () => {
        // index0="1"(prio -1), index1="1"(prio 5) -> index1が勝者で"1"を保持
        const result = normalizeOrders(["1", "1"], [-1, 5]);
        expect(result).toEqual(["2", "1"]);
    });

    test("重複3件以上でも、priority順に勝者の直後へ連続して配置される", () => {
        // index2(prio 9) > index0(prio 3) > index1(prio -1)
        const result = normalizeOrders(["1", "1", "1"], [3, -1, 9]);
        expect(result).toEqual(["2", "3", "1"]);
    });

    test("全員priority未設定(-1)の場合、元の配列インデックスが早い方が勝つ", () => {
        const result = normalizeOrders(["1", "1"], [-1, -1]);
        expect(result).toEqual(["1", "2"]);
    });

    test("敗者は勝者と次に大きい既存値の間に配置される（整数の既存値）", () => {
        const result = normalizeOrders(["1", "1", "2"], [-1, 8, -1]);
        expect(result).toEqual(["2", "1", "3"]);
    });

    test("敗者は勝者と次に大きい既存値の間に配置される（小数の既存値）", () => {
        const result = normalizeOrders(["1", "1", "1.5"], [-1, 5, -1]);
        expect(result).toEqual(["2", "1", "3"]);
    });

    test("重複値自体が小数でも同じ規則で解消される", () => {
        const result = normalizeOrders(["1.5", "1.5", "3"], [-1, 4, -1]);
        expect(result).toEqual(["2", "1", "3"]);
    });

    test("隣接する2つの重複グループが互いに影響しない", () => {
        // "1"グループ(index0,1)と"1.5"グループ(index2,3)が隣接
        const result = normalizeOrders(["1", "1", "1.5", "1.5"], [-1, 5, -1, 7]);
        expect(result).toEqual(["2", "1", "4", "3"]);
    });

    test("階層構造での重複は最後のセグメントのみが解消される", () => {
        const result = normalizeOrders(["1-2", "1-2"], [-1, 7]);
        expect(result).toEqual(["1-2", "1-1"]);
    });

    test("階層構造+孫がいる複合ケース: 孫の親番号は確保されたまま解消される", () => {
        // "1-2"が2件重複しており、別タスクが"1-2-1"を持つ
        const result = normalizeOrders(["1-2", "1-2", "1-2-1"], [-1, 7, -1]);
        expect(result).toEqual(["1-2", "1-1", "1-1-1"]);
        // 勝者(index1)が敗者(index0)より前(小さい)順序になる
        expect(compareOrders(result[1], result[0])).toBeLessThan(0);
    });

    test("重複タスクが子を持つ場合、子は勝者の配下に正規化される", () => {
        // "1"が2件重複し、その下に"1-1"がいる。子の親("1")は勝者の番号を引き継ぐ
        const result = normalizeOrders(["1", "1", "1-1"], [-1, 5, -1]);
        expect(result).toEqual(["2", "1", "1-1"]);
    });

    test("複数レベルで同時に重複していても各レベルで独立に解消される", () => {
        const result = normalizeOrders(
            ["2", "2", "2-1", "2-1", "2-2"],
            [-1, 5, -1, 3, -1]
        );
        expect(result).toEqual(["2", "1", "1-2", "1-1", "1-3"]);
    });

    test("null/undefinedは解消対象外でそのまま返される", () => {
        const result = normalizeOrders(["1", null, "1", undefined], [-1, -1, 5, -1]);
        expect(result).toEqual(["2", null, "1", null]);
    });

    test("非有限セグメント(Infinity)を含むorderは重複解消の対象外になりハングしない", () => {
        // "9"x400 は parseFloat すると Infinity（旧データ・import経由で入りうる）。
        // 有限値への分離が不可能なため集約され、無限ループにもならない
        const huge = "9".repeat(400);
        const result = normalizeOrders(["1", "1", huge], [-1, 5, -1]);
        expect(result).toEqual(["2", "1", "3"]);
    });

    test("非有限値同士の重複は1つの番号に集約される", () => {
        const huge = "9".repeat(400);
        const result = normalizeOrders([huge, huge], [-1, 5]);
        expect(result).toEqual(["1", "1"]);
    });

    test("Number.MAX_VALUEの重複は解消を断念して1つの番号に集約される", () => {
        // Number.MAX_VALUE は有限のため入力検証の対象外になり得る既存データ・
        // インポート経由の値。分離先の有限値が存在しないため集約する
        // （旧 resolveDuplicateOrders の断念時と同じ挙動）
        const maxValueDigits = "17976931348623157" + "0".repeat(292);
        const result = normalizeOrders(
            [maxValueDigits, maxValueDigits, maxValueDigits],
            [-1, 5, -1]
        );
        expect(result).toEqual(["1", "1", "1"]);
        expect(result.every((o) => o == null || !o.includes("Infinity"))).toBe(true);
    });

    test("間隔がulp級の高精度orderでも敗者は勝者と次の既存値の間に配置される", () => {
        // 1.0000000000000002 は 1 の次の表現可能値で、その間に中間値は存在しない。
        // 旧実装では丸めにより敗者がこの既存値を追い越していたが、設計意図である
        // 「勝者と次の既存値の間」への配置が直接実装により保証される
        const next = 1.0000000000000002;
        const result = normalizeOrders(["1", "1", String(next)], [-1, 5, -1]);
        expect(result).toEqual(["2", "1", "3"]);
        expect(compareOrders(result[0], result[2])).toBeLessThan(0); // 敗者 < 既存値
    });

    test("間隔がulp級でも敗者が複数なら全員distinctな連番に分離される", () => {
        const next = 1.0000000000000002;
        const result = normalizeOrders(
            ["1", "1", "1", String(next)],
            [-1, 3, 5, -1]
        );
        const nonNull = result.filter((v): v is string => v != null);
        expect(new Set(nonNull)).toEqual(new Set(["1", "2", "3", "4"]));
        expect(result).toEqual(["3", "2", "1", "4"]);
    });

    test("孤立親プレフィックスが敗者配置区間に介在するケースは旧実装と異なる並び順になる（開示済み差異クラス）", () => {
        // PR #48 レビューで開示した第3の差異クラスの再現テスト。
        // "1.05" は "1.05-1" の途中セグメントとしてのみ現れる孤立親（正規化規則
        // 「存在しない親の子もその親番号を保持」により発生し得る）で、敗者の
        // 配置区間（1 と 2 の間）に介在する。
        // 旧 resolveDuplicateOrders パイプラインは最終セグメントの distinct 値のみで
        // 敗者の散らし区間を計算するため孤立親が不可視となり、敗者は孤立親 1.05 の
        // 部分木の後に配置されて ["3","1","2-1","4"] となっていた。
        // 新実装は孤立親も値グループとして順序に参加させるため、設計意図どおり
        // 敗者が勝者の直後に配置される（重複は解消され、出力は決定的）。
        const result = normalizeOrders(["1", "1", "1.05-1", "2"], [-1, 5, -1, -1]);
        expect(result).toEqual(["2", "1", "3-1", "4"]);
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
