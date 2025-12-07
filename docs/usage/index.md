# ユーザーガイド

`task-memory` (tm) は、AIエージェントや開発者がタスクの状態を管理し、コンテキストの喪失を防ぐためのツールです。

## インストール方法

### ローカルインストール

このリポジトリをクローンし、ローカルコマンドとしてリンクします。

```bash
git clone <repository-url> task-memory
cd task-memory
bun install
bun link
```

これで `tm` コマンドがグローバルに使用可能になります（Bunのbinパスが通っている必要があります）。

または、エイリアスを設定して使用することも可能です。

```bash
alias tm="bun run /path/to/task-memory/src/index.ts"
```

## 基本的な使い方

### 1. タスクの作成 (`tm new`)

新しいタスクを開始する際に使用します。

```bash
tm new "認証機能のリファクタリング"
# 出力: TASK-1 認証機能のリファクタリング
```

### 2. タスク一覧の表示 (`tm list`)

現在進行中（`todo`, `wip`）のタスクを表示します。

```bash
tm list
# 出力: 1: 認証機能のリファクタリング [todo]
```

### 3. タスクの更新 (`tm update`)

タスクの状態を更新したり、作業ログ（body）を追記したりします。
複数のタスクを一度に更新することも可能です。

**ステータスの変更:**

```bash
tm update 1 --status wip
```

**作業ログの追記:**

```bash
tm update 1 --body "JWTの実装を開始"
```

**関連ファイルの追加（AIエージェント向け）:**

```bash
tm update 1 --add-file src/auth.ts
```

**複数タスクの同時更新（コンテキストスイッチ）:**

```bash
tm update 1 --status done 2 --status wip --body "バグ調査中"
# タスク1を完了にし、タスク2をWIPにしてログを追記
```

### 4. タスク詳細の確認 (`tm get`)

タスクの詳細情報（JSON形式）を取得します。AIエージェントがコンテキストを復元するのに役立ちます。

```bash
tm get 1
```

履歴をすべて表示するには `--history` または `--all` オプションを使用します。

```bash
tm get 1 --history
```

### 5. タスクの完了 (`tm finish`)

タスクを完了状態（`done`）にします。

```bash
tm finish 1
```

## データの保存場所

デフォルトでは `~/.task-memory.json` にデータが保存されます。
