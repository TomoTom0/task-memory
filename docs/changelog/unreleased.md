# 次期バージョン（未リリース）

## New Features

- 新status `blocked`（外部条件待ちの強制ブロック）を追加。開始条件 `gate`（自由テキスト、blocked化時は必須）を保持
- `tm block <id> --gate "..."` / `tm unblock <id> [--status wip]` コマンドを追加
- `tm update` に `--gate` / `--force` オプションを追加。blocked からの遷移は CLI が技術的に拒否し、`tm unblock` または `--force`（ユーザー確認後）のみ解除可能
- `tm finish` は blocked タスクを拒否、`tm close` は許可（キャンセル扱い）
- `tm list` で blocked をデフォルト・`--open` から除外（`-a` / `-s blocked` で表示、`[BLOCKED: <gate>]` を表示）

## Bug Fixes

- `tm update --status blocked` で `--gate` の値が未指定（または別オプション）の場合、pre-scanをすり抜けて `gate` 未設定のまま blocked 化されてしまう問題を修正（`--gate` の存在ではなく有効な値を検証するよう厳密化）
- `tm block` / `tm unblock` で `-x` 等の単一ハイフン未知オプションがタスクIDとして誤って解釈される問題を修正（`-` で始まる未知トークンをエラーにするよう統一）

## Changes

（変更内容をここに記載）

## Performance

（変更内容をここに記載）

## Refactoring

（変更内容をここに記載）

## Repository Management

（変更内容をここに記載）

## Internal Improvements

（変更内容をここに記載）

## Known Issues

（変更内容をここに記載）
