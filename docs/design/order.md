# 進行順序（order）フィールド設計書

## 概要

タスクに進行順序を設定し、作業の優先順位を階層的に管理できるようにする。

## 要件

### 基本仕様

- タスクごとに進行順序（order）を設定可能
- 未設定（null/undefined）も許容
- `todo`, `wip` ステータスのみ order を保持
- それ以外のステータス（`pending`, `long`, `done`, `closed`）では自動的に `null`

### フォーマット

- 数字のハイフンつなぎ形式: `1`, `2`, `1-1`, `1-2`, `1-2-1` など
- 入力時は小数も許容: `1.5`, `1-2.5` など
- 保存時に正規化される

### 正規化ルール

1. **親子関係（ハイフン構造）は保持**
2. **各親の下で子番号を1から連番に振り直す**
3. **孫がいる場合、その親番号は「使用済み」として確保**
4. **存在しない親の子もその親番号を保持**

#### 正規化例

**例1: 基本的な欠番詰め**
```
入力:  1, 1-1, 1-3, 2, 3-2
出力:  1, 1-1, 1-2, 2, 3-1
```

**例2: 孫がいる場合**
```
入力:  1, 1-1, 1-2-1, 1-4, 2, 3-2
出力:  1, 1-1, 1-2-1, 1-3, 2, 3-1
```

解説:
- `1` → `1`（トップレベル）
- `1-1` → `1-1`（1の子、1番目）
- `1-2-1` → `1-2-1`（1-2の子、1-2は暗黙的に使用済み）
- `1-4` → `1-3`（1の子、1-1と1-2の次なので3）
- `2` → `2`（トップレベル）
- `3-2` → `3-1`（3の子、1番目に詰める）

### ソート順序

進行順序のソートは以下の規則に従う:

1. ハイフンで区切った各セグメントを数値として比較
2. 左のセグメントから順に比較
3. 同じプレフィックスなら短い方が先

```
1 < 1-1 < 1-1-1 < 1-2 < 2 < 2-1 < 3
```

### tm list のソート

- デフォルトソート: 進行順序（order）昇順
- order が未設定（null）のタスクは後ろに配置
- 同一 order の場合はタスクID（数値部分）昇順

## データ構造

### Task インターフェース変更

```typescript
interface Task {
    id: string
    status: TaskStatus
    priority?: string
    version?: string
    goal?: string
    summary: string
    bodies: TaskBody[]
    files: TaskFiles
    created_at: string
    updated_at: string
    order?: string | null  // 追加: 進行順序
}
```

## CLI オプション

### tm new

```bash
tm new "タスク名" --order 1-1
tm new "タスク名" --order 2.5    # 小数入力可
```

### tm update

```bash
tm update <ID> --order 1-2
tm update <ID> --order null     # order を解除
```

### tm list

```bash
tm list                         # デフォルト: order 昇順
tm list --sort id              # ID昇順でソート
tm list --sort created         # 作成日時昇順でソート
tm list --sort order           # order昇順（デフォルト）
```

## 実装詳細

### 正規化アルゴリズム

```
normalizeOrders(orders: (string | null)[]):
    1. null を除外し、有効な order のみ抽出
    2. 各 order をパース（小数対応）
    3. ソート順でインデックスを付与
    4. 各レベルで使用されている番号を収集
       - 直接の子番号
       - 孫の親として暗黙的に使用される番号
    5. 各レベルで番号を1から振り直し
    6. 正規化された order を返す
```

### パース関数

```typescript
// "1-2.5-3" → [1, 2.5, 3]
function parseOrder(order: string): number[]

// [1, 2, 3] → "1-2-3"
function formatOrder(parts: number[]): string
```

### 比較関数

```typescript
// ソート用比較関数
function compareOrders(a: string | null, b: string | null): number
```

## ステータス変更時の挙動

| 変更前 | 変更後 | order の挙動 |
|--------|--------|-------------|
| todo   | wip    | 保持        |
| wip    | todo   | 保持        |
| todo   | done   | null に     |
| wip    | done   | null に     |
| todo   | pending| null に     |
| done   | todo   | null のまま（手動設定が必要） |

## ファイル変更一覧

1. `src/types.ts` - Task インターフェースに order 追加
2. `src/utils/taskBuilder.ts` - buildTask に order 対応
3. `src/utils/orderUtils.ts` - 新規作成（正規化、ソート関数）
4. `src/commands/new.ts` - --order オプション追加
5. `src/commands/update.ts` - --order オプション追加
6. `src/commands/list.ts` - ソート機能追加
7. `src/store.ts` - 保存時の正規化処理追加

## テスト項目

### 正規化テスト
- 基本的な連番: `1, 3, 5` → `1, 2, 3`
- 階層構造: `1, 1-1, 1-3, 2` → `1, 1-1, 1-2, 2`
- 孫の親確保: `1, 1-2-1, 1-4` → `1, 1-2-1, 1-3`
- 小数入力: `1.5, 1, 2` → `1, 2, 3`
- 深いネスト: `1-1-1-1`

### ソートテスト
- 基本ソート: `2, 1, 3` → `1, 2, 3`
- 階層ソート: `2, 1-1, 1` → `1, 1-1, 2`
- null 後置: `null, 1, null, 2` → `1, 2, null, null`
- 同一 order: ID昇順で解決

### コマンドテスト
- `tm new --order`
- `tm update --order`
- `tm list` ソート順
- ステータス変更時の order クリア
