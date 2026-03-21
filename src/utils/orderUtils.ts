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
            return partsA[i] - partsB[i];
        }
    }
    return 0;
}

/**
 * order を正規化する
 *
 * ルール:
 * 1. 親子関係（ハイフン構造）は保持
 * 2. 各親の下で子番号を1から連番に振り直す
 * 3. 孫がいる場合、その親番号は「使用済み」として確保
 * 4. 存在しない親の子もその親番号を保持
 *
 * @param orders order の配列（null を含む可能性あり）
 * @returns 正規化された order の配列（入力と同じ順序）
 */
/**
 * order を正規化する
 *
 * @param orders order の配列（null を含む可能性あり）
 * @param tiebreakers 競合時の優先度配列（値が大きいほど優先）。同じ order 値が複数ある場合、
 *                    tiebreakers の値が大きいタスクが小さい新 order 番号を得る。
 * @returns 正規化された order の配列（入力と同じ順序）
 */
export function normalizeOrders(
    orders: (string | null | undefined)[],
    tiebreakers?: number[]
): (string | null)[] {
    // 入力インデックスと order のペアを作成
    const indexed = orders.map((order, index) => ({ order, index }));

    // null でないものを抽出
    const nonNull = indexed.filter(
        (item) => item.order != null && item.order !== ""
    );

    if (nonNull.length === 0) {
        return orders.map((o) => (o == null ? null : o));
    }

    // パースして、元のインデックスを保持
    const parsed = nonNull.map((item) => ({
        index: item.index,
        parts: parseOrder(item.order!),
        originalOrder: item.order!,
    }));

    // ソート: order 昇順、同値の場合は tiebreaker 降順（値が大きい＝優先度高いほど先頭）
    parsed.sort((a, b) => {
        const orderCmp = compareOrders(a.originalOrder, b.originalOrder);
        if (orderCmp !== 0) return orderCmp;
        if (tiebreakers) {
            const prioA = tiebreakers[a.index] ?? 0;
            const prioB = tiebreakers[b.index] ?? 0;
            return prioB - prioA; // 優先度高い方が先（小さい新番号を得る）
        }
        return 0;
    });

    // 各深さごとに、親パスをキーとして使用されている番号を収集
    // 構造: Map<parentPath, Set<usedNumbers>>
    // また、暗黙的に使用される番号も収集（孫の親として）

    // すべてのパスと暗黙的な親パスを収集
    // 親パスごとに: 明示的な出現回数（重複を含む）と暗黙的スロットを追跡する
    // キー: `${parentKey}::${childNum}` → 明示的な出現回数
    const explicitCountBySlot = new Map<string, number>();
    // 暗黙的スロット（明示的出現がないがスロット予約が必要なもの）
    const implicitOnlySlots = new Set<string>();

    for (const item of parsed) {
        // 明示的なパス（最終部分）
        const parentKey =
            item.parts.length === 1 ? "" : formatOrder(item.parts.slice(0, -1));
        const childNum = item.parts[item.parts.length - 1];
        const slotKey = `${parentKey}::${childNum}`;
        explicitCountBySlot.set(slotKey, (explicitCountBySlot.get(slotKey) ?? 0) + 1);

        // 暗黙的な親パス（孫の親など）
        for (let len = 1; len < item.parts.length; len++) {
            const pKey = len === 1 ? "" : formatOrder(item.parts.slice(0, len - 1));
            const cNum = item.parts[len - 1];
            const implicitKey = `${pKey}::${cNum}`;
            if (!explicitCountBySlot.has(implicitKey)) {
                implicitOnlySlots.add(implicitKey);
            }
        }
    }

    // 各親パスごとに使用されているスロットをまとめる
    // Map<parentKey, Map<childNum, explicitCount>>
    const slotsByParent = new Map<string, Map<number, number>>();

    for (const [slotKey, count] of explicitCountBySlot.entries()) {
        const sep = slotKey.lastIndexOf("::");
        const pKey = slotKey.slice(0, sep);
        const cNum = parseFloat(slotKey.slice(sep + 2));
        if (!slotsByParent.has(pKey)) slotsByParent.set(pKey, new Map());
        slotsByParent.get(pKey)!.set(cNum, count);
    }

    for (const slotKey of implicitOnlySlots) {
        const sep = slotKey.lastIndexOf("::");
        const pKey = slotKey.slice(0, sep);
        const cNum = parseFloat(slotKey.slice(sep + 2));
        if (!slotsByParent.has(pKey)) slotsByParent.set(pKey, new Map());
        if (!slotsByParent.get(pKey)!.has(cNum)) {
            slotsByParent.get(pKey)!.set(cNum, 0); // 暗黙的スロットは count=0
        }
    }

    // 各親パスごとに、古い番号→新しい番号のリスト（重複分も含む）マッピングを作成
    // Map<parentKey, Map<childNum, newNum[]>>
    const renumberMap = new Map<string, Map<number, number[]>>();

    for (const [pKey, slots] of slotsByParent.entries()) {
        const sorted = Array.from(slots.keys()).sort((a, b) => a - b);
        const mapping = new Map<number, number[]>();
        let newNum = 1;
        for (const oldNum of sorted) {
            const count = slots.get(oldNum)!;
            const newNums: number[] = [];
            const occurrences = count === 0 ? 1 : count; // 暗黙的スロットは1枠確保
            for (let i = 0; i < occurrences; i++) {
                newNums.push(newNum++);
            }
            mapping.set(oldNum, newNums);
        }
        renumberMap.set(pKey, mapping);
    }

    // 各 order を正規化（出現回数トラッカーで重複を区別）
    const normalizedMap = new Map<number, string>();
    // `${parentKey}::${childNum}` → 現在の出現インデックス
    const occurrenceTracker = new Map<string, number>();

    for (const item of parsed) { // ソート済みで処理
        const newParts: number[] = [];

        for (let i = 0; i < item.parts.length; i++) {
            const originalParentKey =
                i === 0 ? "" : formatOrder(item.parts.slice(0, i));
            const oldNum = item.parts[i];

            const mapping = renumberMap.get(originalParentKey);
            if (!mapping) {
                throw new Error(
                    `Internal error: no renumbering map for parent ${originalParentKey}`
                );
            }

            const newNums = mapping.get(oldNum);
            if (newNums === undefined || newNums.length === 0) {
                throw new Error(
                    `Internal error: no new number for ${oldNum} in parent ${originalParentKey}`
                );
            }

            // 最終部分（明示的なタスクの位置）のみ出現カウントを進める
            // 親部分は常に最初の新番号を使う（暗黙的スロットの再利用）
            const isLeaf = i === item.parts.length - 1;
            if (isLeaf && newNums.length > 1) {
                const trackerKey = `${originalParentKey}::${oldNum}`;
                const occIdx = occurrenceTracker.get(trackerKey) ?? 0;
                occurrenceTracker.set(trackerKey, occIdx + 1);
                newParts.push(newNums[occIdx] ?? newNums[newNums.length - 1]!);
            } else {
                newParts.push(newNums[0]!);
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
