# docs 構成

## 常時更新が必要なドキュメント

| ドキュメント | 更新タイミング |
|---|---|
| `docs/usage/index.md` | コマンドの追加・変更時 |
| `docs/usage/agent-claude-md.md` | コマンドの追加・変更時（CLAUDE.mdテンプレート） |
| `docs/usage/agent-guide.md` | タスク管理ルールの変更時 |
| `src/index.ts` helpテキスト | コマンドの追加・オプション変更時 |

## 更新が必要な条件

- 新コマンド追加時: `index.ts` help、`docs/usage/index.md`、`docs/usage/agent-claude-md.md` を更新
- 既存コマンドのオプション追加/変更時: `index.ts` help、`docs/usage/index.md` を更新
- タスク管理ルールの変更時: `docs/usage/agent-claude-md.md`、`docs/usage/agent-guide.md` を更新

## ドキュメント一覧

### usage/
ユーザー・agent向けガイド。`tm docs` で表示される。

- `index.md` - ユーザーガイド（インストール、基本コマンド）
- `agent-claude-md.md` - CLAUDE.md追記用テンプレート（タスク管理ルール）
- `agent-guide.md` - agent向けルールの意図説明

### design/
機能の設計ドキュメント。機能追加時に作成。

- `init.md` - 初期化
- `order.md` - order機能
- `review.md` - review機能
- `blocked.md` - blocked状態・gate（開始条件）
- `sync-setup.md` - tm sync 初回セットアップ改善（clone/remote設定/自動adopt）

### dev/
開発者向けドキュメント。

- `index.md` - 開発ガイド（環境構築、ビルド、テスト）
- `branch-protection.md` - ブランチ保護ルール
- `feature/` - 技術的負債記録

### update/
更新履歴。リリース単位で作成。

- `2025-12-13-list-command-enhancements.md`
- `2026-05-13-pnpm-migration-and-sync-improvements.md`
