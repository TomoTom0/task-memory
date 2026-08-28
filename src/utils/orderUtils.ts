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
 *
 * @param order 検証対象の文字列
 */
export function isValidOrderFormat(order: string): boolean {
    if (!order) return false;
    return /^\d+(\.\d+)?(-\d+(\.\d+)?)*$/.test(order);
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
export function normalizeOrders(
    orders: (string | null | undefined)[]
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

    // ソート
    parsed.sort((a, b) => compareOrders(a.originalOrder, b.originalOrder));

    // 各深さごとに、親パスをキーとして使用されている番号を収集
    // 構造: Map<parentPath, Set<usedNumbers>>
    // また、暗黙的に使用される番号も収集（孫の親として）

    // まず、すべてのパスと暗黙的な親パスを収集
    const allPaths: { path: number[]; implicitParent: boolean }[] = [];

    for (const item of parsed) {
        // 明示的なパス
        allPaths.push({ path: item.parts, implicitParent: false });

        // 暗黙的な親パス（孫の親など）
        for (let len = 1; len < item.parts.length; len++) {
            const parentPath = item.parts.slice(0, len);
            allPaths.push({ path: parentPath, implicitParent: true });
        }
    }

    // 親パスごとに使用されている子番号を収集
    // キー: 親パスを文字列化（例: "" はトップレベル、"1" は 1 の子）
    const usedByParent = new Map<string, Set<number>>();

    for (const { path } of allPaths) {
        if (path.length === 0) continue;

        const parentKey =
            path.length === 1 ? "" : formatOrder(path.slice(0, -1));
        const childNum = path[path.length - 1];

        if (!usedByParent.has(parentKey)) {
            usedByParent.set(parentKey, new Set());
        }
        usedByParent.get(parentKey)!.add(childNum);
    }

    // 各親パスごとに、古い番号から新しい番号へのマッピングを作成
    const renumberMap = new Map<string, Map<number, number>>();

    for (const [parentKey, usedNums] of usedByParent.entries()) {
        const sorted = Array.from(usedNums).sort((a, b) => a - b);
        const mapping = new Map<number, number>();
        sorted.forEach((oldNum, idx) => {
            mapping.set(oldNum, idx + 1); // 1始まり
        });
        renumberMap.set(parentKey, mapping);
    }

    // 各 order を正規化
    const normalizedMap = new Map<number, string>();

    for (const item of parsed) {
        const newParts: number[] = [];

        for (let i = 0; i < item.parts.length; i++) {
            const parentKey = i === 0 ? "" : formatOrder(newParts.slice(0, i));
            const originalParentKey =
                i === 0 ? "" : formatOrder(item.parts.slice(0, i));

            // 親パスの正規化後のキーを計算
            const mapping = renumberMap.get(originalParentKey);
            if (mapping) {
                const newNum = mapping.get(item.parts[i]);
                if (newNum !== undefined) {
                    newParts.push(newNum);
                } else {
                    newParts.push(item.parts[i]);
                }
            } else {
                newParts.push(item.parts[i]);
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
 * x より大きい最小の表現可能な倍精度浮動小数点数を返す（IEEE 754 の nextUp 相当）。
 * 非負の有限数であること（order の各セグメントは非負を前提としている）。
 * 非負の有限数はビットパターンが値の順に単調増加するため、+1 で次の表現可能値になる。
 */
function nextUp(x: number): number {
    if (!Number.isFinite(x)) return x;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    buf.setBigUint64(0, buf.getBigUint64(0) + 1n);
    return buf.getFloat64(0);
}

/**
 * 同一のorder値を持つ要素を、priorityの高い順に微小な小数値へ分離する。
 * normalizeOrders() に通す前の前処理として使う。
 *
 * priority が高い（数値が大きい）要素ほど「新しく設定された」ことを意味し、
 * その要素は元の値をそのまま保持する（勝者）。他の要素（敗者）は、
 * 同じ親配下で「勝者の値」と「次に大きい既存の値（無ければ勝者+1）」の
 * 間に収まる値へ均等に散らされる。
 *
 * 浮動小数点の丸めにより均等分割の位置が前の割り当て値（勝者/前の敗者）以下や
 * 既存の単独値と同値になる場合は、表現可能な次の値（nextUp）へ進めて解消する。
 * 間隔が ulp 級の高精度 order では敗者が区間上限の既存値を超えて配置される
 * ことがあるが、distinct 性と相対順序は保たれ、最終的に normalizeOrders() が
 * 連番へ振り直すため、この時点での値の大きさ自体には意味はない。
 *
 * @param orders order文字列の配列
 * @param priorities 各要素の優先度（未設定/対象外は -1 以下の値にする）
 */
export function resolveDuplicateOrders(
    orders: (string | null | undefined)[],
    priorities: number[]
): (string | null | undefined)[] {
    interface Entry {
        index: number;
        parts: number[];
        parentKey: string;
        last: number;
    }

    const entries: Entry[] = [];
    orders.forEach((o, i) => {
        if (o == null || o === "") return;
        const parts = parseOrder(o);
        if (parts.length === 0) return;
        const parentKey = formatOrder(parts.slice(0, -1));
        entries.push({ index: i, parts, parentKey, last: parts[parts.length - 1]! });
    });

    // 親ごと（parentKey + last）にグループ化し、重複を検出する
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
        const key = `${e.parentKey} ${e.last}`;
        let group = groups.get(key);
        if (!group) {
            group = [];
            groups.set(key, group);
        }
        group.push(e);
    }

    // 親ごとの既存（重複解消前）distinct な last 値（昇順）
    // 敗者を割り当てる区間の境界に使う
    const distinctByParent = new Map<string, number[]>();
    for (const e of entries) {
        let arr = distinctByParent.get(e.parentKey);
        if (!arr) {
            arr = [];
            distinctByParent.set(e.parentKey, arr);
        }
        if (!arr.includes(e.last)) arr.push(e.last);
    }
    for (const arr of distinctByParent.values()) {
        arr.sort((a, b) => a - b);
    }

    const result = [...orders];

    for (const groupEntries of groups.values()) {
        if (groupEntries.length <= 1) continue; // 重複なし

        const parentKey = groupEntries[0]!.parentKey;
        const winnerLast = groupEntries[0]!.last;
        const sortedDistinct = distinctByParent.get(parentKey)!;
        const winnerPos = sortedDistinct.indexOf(winnerLast);
        // 次に大きい既存値（無ければ勝者+1）を上限にして、敗者をその手前に散らす
        const nextValue =
            winnerPos + 1 < sortedDistinct.length
                ? sortedDistinct[winnerPos + 1]!
                : winnerLast + 1;
        const gap = nextValue - winnerLast;

        const sorted = [...groupEntries].sort((a, b) => {
            const pa = priorities[a.index] ?? -1;
            const pb = priorities[b.index] ?? -1;
            if (pa !== pb) return pb - pa; // priority高い方が先頭（=元の値を保持）
            return a.index - b.index; // 同点は元の配列順（安定）
        });

        const n = sorted.length;
        let prev = winnerLast;
        sorted.forEach((e, rank) => {
            if (rank === 0) return; // 勝者はそのまま
            let newLast = winnerLast + (gap * rank) / n; // 理想位置: winnerLast < newLast < nextValue
            // 丸めにより前の割り当て値以下、または既存の単独値と同値になる場合は
            // 表現可能な次の値へ進めて解消する（高精度 order で gap が ulp 級のケース）
            while (newLast <= prev || sortedDistinct.includes(newLast)) {
                newLast = newLast <= prev ? nextUp(prev) : nextUp(newLast);
            }
            prev = newLast;
            const newParts = [...e.parts];
            newParts[newParts.length - 1] = newLast;
            result[e.index] = formatOrder(newParts);
        });
    }

    return result;
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
