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

### クイックスタート

```bash
# タスクの作成
tm new "認証機能のリファクタリング"

# タスク一覧
tm list

# タスクの更新
tm update 1 --status wip --body "JWTの実装を開始"

# タスクの完了
tm finish 1
```

## 開発

開発者向けの情報は [docs/dev/index.md](docs/dev/index.md) を参照してください。

```bash
bun test
```
