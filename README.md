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
Aliases: `tm n` (not yet impl), `tm new`

### List Tasks
```bash
tm list
# or
tm ls
tm l
```
By default, shows `todo` and `wip` tasks.
To include `pending` and `long` tasks:
```bash
tm list --all
tm ls -a
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
