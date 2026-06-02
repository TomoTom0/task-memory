# ユーザーガイド

`task-memory` (tm) は、AIエージェントや開発者がタスクの状態を管理し、コンテキストの喪失を防ぐためのツールです。

## インストール方法

### ローカルインストール

このリポジトリをクローンし、ローカルコマンドとしてリンクします。

```bash
git clone <repository-url> task-memory
cd task-memory
pnpm install
pnpm link --global
```

これで `tm` コマンドがグローバルに使用可能になります。

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
# または短縮形
tm ls
tm l
# 出力: 1: 認証機能のリファクタリング [todo]
```

#### フィルタリングオプション

タスク一覧は様々な条件でフィルタリングできます。

**ステータスによるフィルタリング:**
```bash
# すべてのタスク（done/closed含む）を表示
tm list --status-all
tm ls -a

# オープンなタスク（todo, wip, pending, long）を表示
tm list --open

# 特定のステータスのタスクのみ表示
tm list --status pending
tm ls -s wip
tm ls -s done
```

**優先度によるフィルタリング:**
```bash
tm list --priority high
tm list --priority medium
```

**バージョンによるフィルタリング:**
```bash
# 特定のバージョン
tm list --version 1.0.0

# TBD（未リリース）のタスク
tm list --tbd

# リリース済みのタスク（version が tbd 以外）
tm list --released
```

**表示件数の制限:**
```bash
# 最初の5件のみ表示
tm list --head 5

# 最後の10件のみ表示
tm list --tail 10

# デフォルト値（10件）で制限
tm list --head
tm list --tail
```

**組み合わせ:**
```bash
# リリース済みタスクの最初の3件
tm list --released --head 3

# 高優先度のpendingタスク
tm list --priority high --status pending
```

**ソート順の指定:**
```bash
tm list --sort order    # order昇順（デフォルト）
tm list --sort id       # ID順
tm list --sort created  # 作成日時順
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

**進行順序の設定:**

```bash
tm update 1 --order 1
tm update 2 --order 1-1
tm update 1 --order null   # orderを解除
```

**バージョンの設定:**

```bash
tm update 1 --version 1.0.0
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

#### 出力フィールド

| フィールド | 説明 |
|---|---|
| `id` | タスクID（例: `TASK-1`） |
| `status` | ステータス（`todo`, `wip`, `done`, `pending`, `long`, `closed`） |
| `summary` | タスクの概要 |
| `goal` | 完了目標（省略可） |
| `priority` | 優先度（省略可） |
| `version` | リリースバージョン（未設定時は`tbd`） |
| `order` | 進行順序（`todo`, `wip`のみ設定可能、省略可） |
| `bodies` | 作業ログの配列。各要素は `{ text, created_at }` |
| `files` | 関連ファイル。`read`（参照のみ）と `edit`（編集対象）の配列 |
| `created_at` | 起票日時（ISO 8601） |
| `updated_at` | 最終更新日時（ISO 8601） |
| `created_commit` | 起票時のcommit hash（Gitリポジトリ内のみ、省略可） |
| `updated_commit` | 最終更新時のcommit hash（Gitリポジトリ内のみ、省略可） |

履歴をすべて表示するには `--history` または `--all` オプションを使用します。

```bash
tm get 1 --history
```

最新のbodyのみ表示されます。複数のbodyがある場合は省略件数が表示されます。
先頭と末尾を合わせてN件表示するには `--last` オプションを使用します。

```bash
# 先頭1件 + 末尾1件を表示（計2件）
tm get 1 --last 2
```

### 5. タスクの完了 (`tm finish`)

タスクを完了状態（`done`）にします。

```bash
tm finish 1
```

完了時のコメントを追記することも可能です。

```bash
tm finish 1 --body "レビュー対応完了"
```

### 6. タスクのクローズ (`tm close`)

タスクをクローズ（`closed`）にします。不要になったタスクの取り消しなどに使用します。

```bash
tm close 1
```

クローズ時の理由を追記することも可能です。

```bash
tm close 1 --body "重複タスクのため"
```

### 7. バージョンの設定 (`tm release`)

タスクにリリースバージョンを設定します。リリース準備時に使用します。

```bash
tm release 1 --version 1.0.0
```

### 8. レビュー管理 (`tm review`)

コードレビューの依頼と管理を行います。

```bash
# レビューリクエストを作成
tm review new "リファクタリングの確認" --body "詳細説明"

# レビュー一覧を表示
tm review list

# レビュー詳細を確認
tm review get 1

# レビューを更新（ステータス・コメント）
tm review update 1 --status checking --body "対応完了"

# レビューに返信
tm review return 1 --body "返信内容"

# レビューを承認（タスク作成も可能）
tm review accept 1

# レビューを却下
tm review reject 1
```

### 9. データファイルパスの確認 (`tm env`)

現在のタスクデータファイルのパスを表示します。

```bash
tm env
```

### 10. 同期リポジトリでのGit操作 (`tm git`)

`~/.local/task-memory/` リポジトリでGitコマンドを実行します。

```bash
tm git log --oneline -5
tm git status
```

## データの保存場所

Gitリポジトリ内で実行した場合、`.git/task-memory.json` に保存されます。
Gitリポジトリ外で実行するとエラーになります。

### グローバルモード

`--global` / `-G` オプションを使用すると、Gitリポジトリの有無に関わらず `~/.task-memory.json` に保存されます。

```bash
tm --global list
tm -G new "タスク"
```

### coding agentからの呼び出し

環境変数 `CODING_AGENT_ROOT` が設定されている場合、そのパスをプロジェクトルートとして使用します。
この環境変数はcoding agent側で設定する必要があります。

## 同期 (`tm sync`)

`~/.local/task-memory/` リポジトリ経由でタスクデータを管理・共有します。

### 初期設定

```bash
# プロジェクトをsyncに追加（IDは省略するとremote originのURLから自動生成）
tm sync add --save

# IDを明示的に指定する場合
tm sync add --id my-project --save
```

### sync IDの変更

```bash
# sync IDを変更
tm sync set --id new-name

# 同期モードを変更（auto: タスク変更時に自動でsave）
tm sync set auto
tm sync set manual

# IDとモードを同時に変更
tm sync set --id new-name auto
```

### データの保存とpush

```bash
# ローカルに保存
tm sync save

# リモートにpush
tm sync push
```

### データの取得

```bash
# リモートから取得（上書き）
tm sync pull

# マージモードで取得
tm sync pull --merge
```

### 状態確認

```bash
tm sync status
tm sync list
```

## ドキュメントの表示 (`tm docs`)

各種ドキュメントを表示します。AIエージェントの設定に利用できます。

```bash
# ユーザーガイド（デフォルト）
tm docs
tm docs usage

# CLAUDE.md追記用テンプレート
tm docs agent-claude-md

# agent向けルールの意図説明
tm docs agent-guide
```
