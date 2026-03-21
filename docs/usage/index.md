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

#### 進行順序の設定

タスクに進行順序（order）を設定することで、作業の優先順位を階層的に管理できます。

**基本的な使い方:**
```bash
# 順番に並べる
tm new "Task 1" --order 1
tm new "Task 2" --order 2
tm new "Task 3" --order 3
```

**階層的な順序:**
```bash
# 親タスク
tm new "Database Migration" --order 1

# 子タスク（1の下位タスク）
tm new "Backup current DB" --order 1-1
tm new "Run migration script" --order 1-2
tm new "Verify data integrity" --order 1-3

# 孫タスク（1-2の下位タスク）
tm new "Test migration locally" --order 1-2-1
tm new "Deploy to staging" --order 1-2-2

# 別の親タスク
tm new "Documentation" --order 2
```

**小数での挿入:**
```bash
# すでに 1, 2 がある場合、間に挿入
tm new "Insert between 1 and 2" --order 1.5
# 保存時に自動的に正規化されて 1, 2, 3 になります
```

**order の特徴:**
- `todo`, `wip` ステータスのみ order を保持
- `done`, `closed`, `pending`, `long` に変更すると order は自動的に解除
- 欠番は自動的に詰められる（1, 3, 5 → 1, 2, 3）
- 孫タスクがある場合、その親番号は確保される
- 既存の order と同じ値を設定すると、新しいタスクが優先され、既存タスクは後ろにシフトされる

**既存 order への挿入（インサートセマンティクス）:**
```bash
# order=1 が A, B, C に割り当てられている場合に新タスクへ order=1 を設定すると
# → 新タスク=1, A=2, B=3, C=4 と全体がシフトする
tm update <新タスクID> --order 1
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

#### ソート順の指定

デフォルトでは進行順序（order）でソートされます。

```bash
# 進行順序でソート（デフォルト）
tm list --sort order
# order が未設定のタスクは後ろに表示されます
# 1 < 1-1 < 1-2 < 2 < 2-1 の順

# タスクID順
tm list --sort id

# 作成日時順
tm list --sort created
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

**進行順序の更新:**

```bash
# order を設定
tm update 1 --order 1-2

# order を解除
tm update 1 --order null
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

以下の優先順位でデータの保存先が決定されます。

| 優先度 | 条件 | 保存先 |
|--------|------|--------|
| 1 | 環境変数 `TASK_MEMORY_PATH` が設定されている | 環境変数で指定したパス |
| 2 | `.git` ディレクトリが存在し、かつ `.git/task-memory.json` が存在する | `.git/task-memory.json` |
| 3 | `.git`（ファイル・ディレクトリ問わず）と同じ階層に `task-memory.json` が存在する | `<プロジェクトルート>/task-memory.json` |
| 4 | `.git` と同じ階層に `.task-memory.json` が存在する | `<プロジェクトルート>/.task-memory.json` |
| 5 | `.git` が存在するが保存ファイルがない（新規） | `.git/task-memory.json`（`.git` がディレクトリの場合）または `<プロジェクトルート>/task-memory.json` |
| 6 | `.git` が存在しない | `~/.task-memory.json` |

### git worktree での利用

`git worktree` 使用時は `.git` がファイルになりますが、そのファイルと同じ階層の `task-memory.json` または `.task-memory.json` が自動的に参照されます。これにより、worktree ごとに独立したタスク管理が可能です。

## 同期機能 (`tm sync`)

タスクデータを共有ディレクトリ経由で複数環境間で同期します。

### セットアップ

```bash
# 同期を有効化（sync ID を自動生成）
tm sync add

# 暗号化を有効化（age 鍵を自動生成）
tm sync add --encrypt

# 既存の鍵ファイルを指定して暗号化
tm sync add --encrypt --key /path/to/age.key

# 同期 ID を指定（複数マシン間で同じIDを使う場合）
tm sync add --id my-project-sync
```

### 基本操作

```bash
# タスクをプッシュ
tm sync push

# タスクをプル（リモートで上書き）
tm sync pull

# タスクをプルしてローカルとマージ
tm sync pull --merge

# 同期状態を確認
tm sync status

# 同期を無効化
tm sync remove
```

### マージ動作

`--merge` オプションでは以下のルールでマージされます：

- **同一タスク**（ID と作成日時が一致）: `updated_at` が新しい方を優先
- **ID 衝突**（同じ ID だが別のタスク）: リモートのタスクに新しい ID を割り当てて追加
- **新規タスク**: そのまま追加

### 暗号化

`--encrypt` オプションを使うと [age](https://age-encryption.org/) によって SSH 鍵互換の暗号化が有効になります。

```bash
# 暗号化付きで同期を有効化（鍵は自動生成）
tm sync add --encrypt
# → ~/.local/task-memory/age.key に鍵ファイルを生成

# 同期ファイルは .json.age として保存され、pull 時に自動復号される
```

**注意**: 鍵ファイルを紛失するとデータを復元できません。鍵ファイルは安全な場所にバックアップしてください。
