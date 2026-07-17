# blocked 状態・開始条件 gate 設計書

## 概要

開始条件（gate）が揃うまで着手できないタスクを表す `blocked` ステータスと、LLM が勝手に再開するのを技術的に防ぐガードを導入する。

## 背景

LLM が `pending` を todo 程度に軽視し、開始条件を無視して勝手に `pending→wip` で再開する問題があった。pending は名前が弱く（「保留中」）、待つ理由の記録場所も再開ガードもなかった。

## 要件

### status
- `blocked`: 外部条件待ちの強制ブロック。着手禁止。
- `pending`: 自分の一時保留（従来通り、いつでも再開可能）。残す。

### gate（開始条件フィールド）
- `Task.gate?: string`（自由テキスト）
- `blocked` 化時は必須。

### 技術ガード
- `blocked → 他status` への遷移は CLI が拒否。
- 解除は `tm unblock` または `update --force`（ユーザー確認後）のみ。
- `tm finish` は blocked を拒否。`tm close` は許可（キャンセル扱い）。
- ガードは throw せず per-task で `console.error` して継続（一括実行時の巻き添え回避）。

### コマンド
- `tm block <id...> --gate "..."`: blocked 化（gate 必須、todo/wip/pending/long から）。
- `tm unblock <id...> [--status todo|wip]`: gate クリア、デフォルト todo。
- `tm update --status blocked --gate "..."`: update 経由（--gate 必須）。
- `tm update --status <他> --force`: blocked からの強制遷移。

### 表示
- `tm list`: blocked はデフォルト・`--open` から除外。`-a`/`-s blocked` で表示、`[BLOCKED: <gate>]`。

## 設計判断

- **unblock のデフォルトは todo**: wip にすると1操作で再開状態になりガードが薄くなる。「解除」と「着手」を分離。
- **gate は unblock 時にクリア**: gate は状態制約の一部。理由は `--body` で bodies に残せる。
- **--force は update のグローバルフラグ（pre-scan）**: 指定順序に依存させない。
- **canTransition は blocked exit のみ禁止**: 他の遷移は現状通り自由（既存挙動を変えない）。表駆動で将来拡張可能。
- **sync pull はガード対象外**: CLI invocation 単位のガード。外部流入はユーザー責任。

## 関連

- 実装: `src/utils/statusGuard.ts`, `src/commands/block.ts`, `src/commands/unblock.ts`
- 型: `src/types.ts`（`TaskStatus` に `blocked`、`Task` に `gate`）
- ガード関数: `isTaskStatus`, `canTransition`, `requiresGate`, `blockedExitMessage`
