/**
 * 進行順序（order）のユーティリティ関数
 *
 * order のフォーマット: "1", "1-1", "1-2-3" など（ハイフン区切りの数字）
 * 入力時は小数も許容: "1.5", "1-2.5" など
 */

/**
 * order 文字列を数値配列にパースする
 * @param order "1-2-3" のような文字列
 * @returns [1, 2, 3] のような数値配列
 */
export function parseOrder(order: string): number[] {
    if (!order || order === "") {
        return [];
    }
    return order.split("-").map((s) => parseFloat(s));
}

/**
 * 数値配列を order 文字列にフォーマットする
 * @param parts [1, 2, 3] のような数値配列
 * @returns "1-2-3" のような文字列
 */
export function formatOrder(parts: number[]): string {
    if (parts.length === 0) {
        return "";
    }
    return parts.map((n) => String(n)).join("-");
}

/**
 * order 文字列の形式が正しいか検証する
 * 各セグメントが非負の数値（整数または小数）で、ハイフンで区切られていること
 * （例: "1", "1-1", "2-3", "1.5", "1-2.5" は有効。"abc", "-1", "1-", "1--2" は無効）
 * 桁数が大きすぎて parseFloat が Infinity を返すセグメントも無効とする
 * Number.MAX_VALUE に等しいセグメントも無効とする（重複解消の割り当て可能な
 * 有限値が存在せず、集約扱いになるため）
 *
 * @param order 検証対象の文字列
 */
export function isValidOrderFormat(order: string): boolean {
    if (!order) return false;
    if (!/^\d+(\.\d+)?(-\d+(\.\d+)?)*$/.test(order)) return false;
    return order.split("-").every((s) => {
        const v = parseFloat(s);
        // 有限かつ Number.MAX_VALUE 未満であること（重複解消が別々の有限値への
        // 分離を保証できるのはこの範囲のみのため）
        return Number.isFinite(v) && v < Number.MAX_VALUE;
    });
}

/**
 * order 文字列を比較する
 * null/undefined は後ろに配置される
 *
 * @param a 比較対象1
 * @param b 比較対象2
 * @returns 負: a < b, 0: a == b, 正: a > b
 */
export function compareOrders(
    a: string | null | undefined,
    b: string | null | undefined
): number {
    // null/undefined は後ろ
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;

    const partsA = parseOrder(a);
    const partsB = parseOrder(b);

    // 各セグメントを順に比較
    const maxLen = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < maxLen; i++) {
        // 短い方は末尾に 0 があると仮定せず、短い方が先
        if (i >= partsA.length) return -1; // a が短い -> a が先
        if (i >= partsB.length) return 1; // b が短い -> b が先

        if (partsA[i] !== partsB[i]) {
            return partsA[i]! - partsB[i]!;
        }
    }
    return 0;
}

/**
 * order を正規化する（重複する order の解消を含む）
 *
 * ルール:
 * 1. 親子関係（ハイフン構造）は保持
 * 2. 各親の下で子番号を1から連番に振り直す
 * 3. 孫がいる場合、その親番号は「使用済み」として確保
 * 4. 存在しない親の子もその親番号を保持
 * 5. 同一の親配下で同じ子番号で終わる order が複数ある場合（重複）は、
 *    優先度が最も高い要素が元の値の位置を保持し、他の要素は優先度順
 *    （priority 降順 → 元の配列順）でその直後へ連続して配置される
 *    （= 勝者の値と次に大きい既存値の間に収まる）
 *
 * 重複を解消できない値（非有限セグメント由来の Infinity、および
 * Number.MAX_VALUE）の重複は、分離先の有限値が存在しないため1つの番号に集約される。
 * 入力検証（isValidOrderFormat）で流入を防止しているが、旧データ・import 経由で
 * 入りうる値のため断念扱いとする（旧 resolveDuplicateOrders の断念時と同じ挙動）
 *
 * @param orders order の配列（null を含む可能性あり）
 * @param priorities 各要素の優先度（orders と同じ位置対応。数値が大きいほど
 *   新しく設定されたことを意味する。未設定は -1 以下。省略時は全要素未設定扱いで、
 *   配列の出現順で決定的に解消される）
 * @returns 正規化された order の配列（入力と同じ順序）
 */
export function normalizeOrders(
    orders: (string | null | undefined)[],
    priorities: number[] = []
): (string | null)[] {
    interface Member {
        index: number;
        priority: number;
    }
    interface ValueGroup {
        /** この値で終わる（最後のセグメントがこの値の）order のメンバー。重複解消の対象 */
        members: Member[];
    }

    // null でも空文字列でもない order を、入力インデックス付きでパースする
    const parsed: { index: number; parts: number[] }[] = [];
    orders.forEach((order, index) => {
        if (order == null || order === "") return;
        parsed.push({ index, parts: parseOrder(order) });
    });

    if (parsed.length === 0) {
        return orders.map((o) => (o == null ? null : o));
    }

    // 親パスごと・子番号の値ごとにグループを収集する
    // 構造: Map<parentKey, Map<value, ValueGroup>>
    // - parentKey: 親パスを文字列化したもの（"" はトップレベル）
    // - より深い order の途中セグメントとして現れる値も同じ値のグループで
    //   番号を確保する（勝者と同じ値のため、同一のスロット列に集約される）
    // - グループは値ごとに連番スロット列を持ち、メンバー（その値で終わる order）が
    //   優先度順に並ぶ。重複が無ければ1メンバー=1スロットで、値の順位がそのまま連番になる
    const groupsByParent = new Map<string, Map<number, ValueGroup>>();

    const groupFor = (parentKey: string, value: number): ValueGroup => {
        let byValue = groupsByParent.get(parentKey);
        if (!byValue) {
            byValue = new Map();
            groupsByParent.set(parentKey, byValue);
        }
        let group = byValue.get(value);
        if (!group) {
            group = { members: [] };
            byValue.set(value, group);
        }
        return group;
    };

    for (const item of parsed) {
        const last = item.parts.length - 1;
        for (let depth = 0; depth <= last; depth++) {
            const parentKey =
                depth === 0 ? "" : formatOrder(item.parts.slice(0, depth));
            const value = item.parts[depth]!;
            if (depth === last) {
                // この order 自身の最終セグメント: 重複解消のメンバーとして登録
                groupFor(parentKey, value).members.push({
                    index: item.index,
                    priority: priorities[item.index] ?? -1,
                });
            } else {
                // 途中セグメント: 暗黙的な使用として番号を確保する
                groupFor(parentKey, value);
            }
        }
    }

    // 各親パスごとに、値の昇順・重複グループ内は優先度順（priority 降順 → 入力順）で
    // 1始まりの連番を割り当てる
    interface AssignedGroup {
        /** この値に割り当てられた先頭の連番（途中セグメント参照・解消断念時の参照先） */
        firstSlot: number;
        /** order の入力インデックス -> 連番（最終セグメント参照用） */
        memberSlots: Map<number, number>;
    }
    const assignedByParent = new Map<string, Map<number, AssignedGroup>>();

    for (const [parentKey, byValue] of groupsByParent.entries()) {
        const assigned = new Map<number, AssignedGroup>();
        const values = Array.from(byValue.keys()).sort((a, b) => a - b);
        let slot = 1;
        for (const value of values) {
            const group = byValue.get(value)!;
            // 重複を解消できるのは、値も親パスのセグメントも有限で、かつ値が
            // Number.MAX_VALUE 未満のグループのみ。それ以外（Infinity を含むパスや
            // MAX_VALUE）は分離先の有限値が存在し得ないため、1つの番号に集約する
            const spreadable =
                group.members.length > 1 &&
                Number.isFinite(value) &&
                value < Number.MAX_VALUE &&
                parseOrder(parentKey).every(Number.isFinite);
            if (spreadable) {
                const ranked = [...group.members].sort((a, b) => {
                    if (a.priority !== b.priority) {
                        return b.priority - a.priority;
                    }
                    return a.index - b.index;
                });
                const memberSlots = new Map<number, number>();
                let s = slot;
                for (const member of ranked) {
                    memberSlots.set(member.index, s);
                    s++;
                }
                assigned.set(value, { firstSlot: slot, memberSlots });
                slot = s;
            } else {
                assigned.set(value, {
                    firstSlot: slot,
                    memberSlots: new Map(),
                });
                slot++;
            }
        }
        assignedByParent.set(parentKey, assigned);
    }

    // 各 order を、元の親パスで割り当てを引いて正規化する
    const normalizedMap = new Map<number, string>();

    for (const item of parsed) {
        const last = item.parts.length - 1;
        const newParts: number[] = [];

        for (let depth = 0; depth <= last; depth++) {
            const originalParentKey =
                depth === 0 ? "" : formatOrder(item.parts.slice(0, depth));
            const value = item.parts[depth]!;
            const assigned = assignedByParent
                .get(originalParentKey)
                ?.get(value);
            if (assigned) {
                if (depth === last) {
                    // 最終セグメント: この order 自身の連番
                    // （解消断念グループのメンバーは先頭番号に集約される）
                    newParts.push(
                        assigned.memberSlots.get(item.index) ??
                            assigned.firstSlot
                    );
                } else {
                    // 途中セグメント: 勝者（元の値を保持したメンバー）と同じ番号
                    newParts.push(assigned.firstSlot);
                }
            } else {
                newParts.push(value);
            }
        }

        normalizedMap.set(item.index, formatOrder(newParts));
    }

    // 結果を元の順序で返す
    return orders.map((o, index) => {
        if (o == null) return null;
        return normalizedMap.get(index) ?? o;
    });
}

/**
 * タスク配列を order でソートする
 *
 * @param items ソート対象の配列
 * @param getOrder order を取得する関数
 * @param getId ID を取得する関数（同一 order の場合のタイブレーク用）
 * @returns ソートされた新しい配列
 */
export function sortByOrder<T>(
    items: T[],
    getOrder: (item: T) => string | null | undefined,
    getId: (item: T) => string
): T[] {
    return [...items].sort((a, b) => {
        const orderA = getOrder(a);
        const orderB = getOrder(b);

        const cmp = compareOrders(orderA, orderB);
        if (cmp !== 0) return cmp;

        // 同一 order の場合は ID でソート
        const idA = getId(a);
        const idB = getId(b);

        // TASK-1, TASK-2 のような形式から数値部分を抽出
        const numA = parseInt(idA.replace(/\D/g, ""), 10) || 0;
        const numB = parseInt(idB.replace(/\D/g, ""), 10) || 0;

        return numA - numB;
    });
}
