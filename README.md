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
pnpm install
pnpm link --global
```

これで `tm` コマンドが使用可能になります。

## 使い方

詳細な使い方は [docs/usage/index.md](docs/usage/index.md) を参照してください。

## Usage

### Create a Task
```bash
tm new "Refactor auth" --status wip --body "Starting now" --priority high --goal "Complete by Friday"
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

# オープンなタスク（todo, wip, pending, long）を表示（blockedは含まない）
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

### Block / Unblock a Task

Mark a task as blocked when it cannot start until some condition is met.
A blocked task cannot be resumed via `tm update --status wip` or `tm finish`
(rejected unless forced); resume it explicitly with `tm unblock`.

```bash
# Block (gate = the start condition that must be met; required)
tm block 1 --gate "After TASK-3 is done"

# Unblock (clears the gate; default target status is todo)
tm unblock 1
tm unblock 1 --status wip   # resume immediately

# Force-resume a blocked task (only with explicit user approval)
tm update 1 --status wip --force
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

### Sync
```bash
# プロジェクトをsyncに追加
tm sync add --id my-project --save

# ローカルに保存
tm sync save

# リモートにpush
tm sync push

# リモートから取得
tm sync pull --merge
```

### Git (sync repository)
```bash
tm git status
tm git remote add origin <url>
tm git push
```

## 開発

開発者向けの情報は [docs/dev/index.md](docs/dev/index.md) を参照してください。

```bash
bun test
```
