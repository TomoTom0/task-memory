
# 実装依頼書: CLI Tool `task-memory` (tm)

## 1\. プロジェクト概要

**ツール名:** `task-memory` (エイリアス: `tm`)
**目的:** LLM（Large Language Model）を用いた開発において、コンテキストリセット（記憶喪失）対策としてタスクの状態と「思考の履歴」を外部保存するためのCLIツール。
**主な利用者:** AIエージェント（Claude Code等）および人間。

### 重要な設計思想

1.  **State Keeper:** 複雑なタスク管理機能は不要。あくまで「状態のセーブ＆ロード」に徹する。
2.  **LLM Native:** 出力はJSONを基本とし、トークン効率を意識した設計にする。
3.  **Context-Aware Parser:** `update` コマンドにおいて、IDの出現順序に基づいたステートフルな引数解析を行う。

-----

## 2\. データ構造 (Schema)

データはローカルのJSONファイル（例: `~/.task-memory.json` または SQLite）に永続化する。

### Task Object

```json
{
  "id": "TASK-1",       // プレフィックス付きID (内部管理用)
  "status": "todo",     // enum: "todo", "wip", "done"
  "summary": "認証機能のリファクタリング",
  
  // 思考履歴 (Append-only)
  "bodies": [
    {
      "text": "要件定義: JWTの有効期限を修正する。",
      "created_at": "2023-12-07T10:00:00Z"
    },
    {
      "text": "実装完了。次はテスト。",
      "created_at": "2023-12-07T12:00:00Z"
    }
  ],

  // 関連ファイルパス (LLMのコンテキスト制御用)
  "files": {
    "read": ["src/types/auth.ts"],     // 参照用（書き換えない）
    "edit": ["src/utils/validation.ts"] // 編集対象
  },

  "created_at": "2023-12-07T10:00:00Z",
  "updated_at": "2023-12-07T12:00:00Z"
}
```

-----

## 3\. コマンド仕様

CLIコマンドのプレフィックスは `tm` とする。

### 3.1 `tm new`

新しいタスクを作成する。

  * **Syntax:** `tm new <summary>`
  * **Behavior:**
      * IDを自動採番（例: `TASK-N`）。
      * `status` は `todo` で初期化。
      * 作成されたタスクのIDとSummaryを標準出力に返す。

### 3.2 `tm list`

進行中のタスクを一覧表示する。

  * **Syntax:** `tm list`
  * **Behavior:**
      * `status` が `done` 以外のタスクを表示。
      * **Output Format:** トークン節約のため、極めて短くする。
    <!-- end list -->
    ```text
    1: 認証機能のリファクタリング [wip]
    2: バグ修正 [todo]
    ```

### 3.3 `tm get`

タスクの詳細（コンテキスト）を取得する。

  * **Syntax:** `tm get <id...> [options]`
  * **Args:** IDは複数指定可能。整数（`1`）と文字列（`TASK-1`）の両方を許容する。
  * **Options:**
      * `--all` / `--history`: これを指定しない限り、`bodies` 配列は\*\*「最新の1件」のみ\*\*を表示する（デフォルト動作）。指定時は全履歴を表示。
  * **Output:** 配列形式のJSON。

### 3.4 `tm finish`

タスクを完了にする。

  * **Syntax:** `tm finish <id...>`
  * **Behavior:** 指定された全タスクの `status` を `done` に更新する。

### 3.5 `tm update` (重要: カスタム引数解析)

タスクの状態を更新する。**引数の出現順序に依存した解析ロジック**を実装すること。

  * **Syntax:** `tm update <id> [options] [<id> [options] ...]`

  * **Options:**

      * `--status <status>`: ステータス変更。
      * `--body <text>`: `bodies` 配列への追記（上書きではない）。
      * `--add-file <path>` / `--rm-file <path>`: `files.edit` への追加・削除（デフォルトはedit）。
      * `--read-file <path>`: `files.read` への追加。

  * **Parsing Logic:**

    1.  引数を左から右へスキャンする。
    2.  **ID（数値または `TASK-n`）** を検出したら、「現在のターゲットタスク」をそのIDに切り替える。
    3.  以降のオプション（`--body` 等）は、次に別のIDが出現するまで「現在のターゲットタスク」に対して適用される。
    4.  IDが連続した場合（例: `tm update 1 2 --status done`）、そのオプションは**現在アクティブな全てのターゲット**（この場合は1と2）に適用される。

    **例:**

    ```bash
    tm update 1 --body "Fix A" 2 --body "Fix B"
    # Task 1 に body "Fix A" を追加
    # Task 2 に body "Fix B" を追加
    ```

-----

## 4\. 非機能要件・実装制約

1.  **ID Handling:**
      * ユーザー入力が整数 `1` の場合、内部的に `TASK-1` として検索・保存する。
      * 出力時もCLI上では見やすさのため整数で表示しても良いが、JSONデータ上は `TASK-` プレフィックスを維持する。
2.  **Error Handling:**
      * 複数ID指定時に一部のIDが存在しない場合、処理を中断せず、存在するIDのみ更新し、存在しなかったIDを警告として標準エラー出力に表示する（Partial Success）。
3.  **File Validation:**
      * `--add-file` で指定されたパスが存在するかどうかのチェックは**行わない**（AIが未作成のファイルを計画段階で登録する可能性があるため）。

-----

## 5\. 開発者へのメモ

このツールは、LLM自身が「自分の記憶」を管理するために使用します。そのため、**エラーメッセージは「人間向け」ではなく「LLMへの修正指示」として機能するよう記述してください。**

  * Bad: `Invalid argument.`
  * Good: `Error: ID '99' not found. Please run 'tm list' to see available tasks.`