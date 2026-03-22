# テスト構成

## 実行方法

```bash
bun test
```

## テストファイル一覧

| ファイル | テスト対象 | 更新タイミング |
|---|---|---|
| `test/new.test.ts` | `tm new` コマンド | new コマンドの変更時 |
| `test/list.test.ts` | `tm list` コマンド | list コマンドの変更時 |
| `test/update.test.ts` | `tm update` コマンド | update コマンドの変更時 |
| `test/orderUtils.test.ts` | order 正規化ロジック | order 関連の変更時 |
| `test/syncMerge.test.ts` | `mergeTasks` 関数 | マージロジックの変更時 |
| `test/syncStore.test.ts` | `normalizeRemoteUrl` 関数 | sync URL 正規化の変更時 |
| `test/syncEncrypt.test.ts` | 暗号化設定解決ロジック | 暗号化設定の変更時 |
| `test/encryption.test.ts` | age 暗号化・復号関数 | 暗号化実装の変更時 |
| `test/review.test.ts` | `tm review` コマンド | review コマンドの変更時 |
| `test/git_search.test.ts` | git 検索関連 | git 連携の変更時 |

## テスト更新が必要なタイミング

- コマンドの追加・変更・削除時
- オプションの追加・変更・削除時
- ロジック（マージ・暗号化・order 正規化など）の変更時

## 重要なテスト対象

- `resolveEncryptSettings`: 暗号化設定の優先順位（プロジェクト > グローバル > デフォルト）
- `mergeTasks`: ID 衝突・同一タスク判定・マージ動作
- `normalizeRemoteUrl`: 各種 git リモート URL の正規化
