# ドキュメント構成

## 構成

| ファイル | 内容 | 更新タイミング |
|---|---|---|
| `docs/usage/index.md` | ユーザーガイド（コマンド使用方法） | コマンドの追加・変更・削除時 |
| `docs/usage/agent-claude-md.md` | CLAUDE.mdに追記する内容（coding agent向け） | tmのタスク管理ルールが変わった時 |
| `docs/usage/agent-guide.md` | agent-claude-mdの各ルールの意図・説明 | tmのタスク管理ルールが変わった時 |
| `docs/dev/index.md` | 開発者ガイド（環境構築・設計） | 開発環境や設計方針の変更時 |
| `docs/design/*.md` | 設計ドキュメント | 機能設計の追加・変更時 |
| `docs/changelog/unreleased.md` | 未リリースの変更履歴 | 機能追加・バグ修正のたびに追記 |
| `docs/changelog/v*.md` | リリース済みの変更履歴 | リリース時 |

## 常時更新が必要なドキュメント

### `docs/usage/index.md`

以下の変更時に必ず更新する：

- `src/commands/` 配下のコマンド追加・変更・削除
- コマンドオプションの追加・変更・削除
- 動作仕様の変更

### `docs/usage/agent-claude-md.md`

以下の変更時に更新する：

- タスク管理のルールやベストプラクティスの変更
- `tm docs agent-claude-md` で閲覧、`tm docs agent-claude-md >> CLAUDE.md` でそのまま追記可能
- 各ルールの意図は `docs/usage/agent-guide.md`（`tm docs agent-guide`）に記載

### `docs/changelog/unreleased.md`

以下の変更時に追記する：

- 新機能の追加
- バグ修正
- 破壊的変更

## 更新漏れチェック

`/check-doc-updates` スキルで確認できる。
