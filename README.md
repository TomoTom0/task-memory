# task-memory (tm)

AIエージェント（および人間）がタスクの状態とコンテキストを管理し、長時間のセッションにおける「記憶喪失」を防ぐためのCLIツールです。

## 特徴

- **状態の永続化**: タスクの状態を `~/.task-memory.json` に保存します。
- **コンテキストスイッチ**: `tm update` コマンドで複数のタスクを一度に更新できます。
- **LLMフレンドリー**: AIエージェントが理解しやすいJSON形式で出力します。

## インストール

### ローカルインストール

```bash
git clone <repository-url> task-memory
cd task-memory
bun install
bun link
```

これで `tm` コマンドが使用可能になります。

## 使い方

詳細な使い方は [docs/usage/index.md](docs/usage/index.md) を参照してください。

## Usage

### Create a Task
```bash
tm new "Refactor auth" --status wip --body "Starting now" --priority high --goal "Complete by Friday"
```

**進行順序の設定:**
```bash
# 基本的な順序
tm new "Task 1" --order 1
tm new "Task 2" --order 2

# 階層的な順序（親子関係）
tm new "Parent Task" --order 1
tm new "Child Task 1" --order 1-1
tm new "Child Task 2" --order 1-2
tm new "Grandchild Task" --order 1-2-1

# 小数での挿入（保存時に自動正規化）
tm new "Insert Task" --order 1.5
```

Aliases: `tm n` (not yet impl), `tm new`

### List Tasks
```bash
tm list
# or
tm ls
tm l
```
By default, shows `todo` and `wip` tasks.

**Filtering Options:**
```bash
# すべてのタスク（done/closed含む）を表示
tm list --status-all
tm ls -a

# オープンなタスク（todo, wip, pending, long）を表示
tm list --open

# ステータスでフィルタリング
tm list --status pending
tm ls -s wip

# 優先度でフィルタリング
tm list --priority high

# バージョンでフィルタリング
tm list --version 1.0.0
tm list --tbd           # version が tbd のタスク
tm list --released      # リリース済み（version が tbd 以外）のタスク

# 表示件数を制限
tm list --head 5        # 最初の5件
tm list --tail 10       # 最後の10件
tm list --head          # 最初の10件（デフォルト）

# ソート順の指定
tm list --sort order    # 進行順序でソート（デフォルト）
tm list --sort id       # タスクID順
tm list --sort created  # 作成日時順
```

### Update a Task
```bash
tm update 1 --status done
# or
tm up 1 -s done
tm u 1 -s done
```
Supports context switching:
```bash
tm up 1 -s done 2 -s wip
```

Update version:
```bash
tm update 1 --version 1.0.0
# or
tm u 1 -v 1.0.0
```

Update order:
```bash
tm update 1 --order 1-2
# or
tm u 1 -o 1-2

# order を解除
tm update 1 --order null
```

### Get Task Details
```bash
tm get 1
# or
tm g 1
```

### Finish a Task
```bash
tm finish 1
# or
tm fin 1
tm f 1
```

### Reviews
```bash
tm review new "Design Review" --body "Check this out"
# or
tm rev new ...
tm tmr new ...
```
Subcommands: `new`, `list`, `get`, `update`, `return`, `accept`, `reject`.

### Environment
```bash
tm env
```

## 開発

開発者向けの情報は [docs/dev/index.md](docs/dev/index.md) を参照してください。

```bash
bun test
```
