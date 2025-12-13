# tm list コマンドの機能強化

**日付**: 2025-12-13

## 概要

`tm list` (alias: `tm ls`, `tm l`) コマンドに以下の機能を追加しました:

1. `--status` (`-s`) オプションによる明示的なステータスフィルタリングの修正
2. `--head [N]` および `--tail [N]` オプションによる表示件数制限

## 修正内容

### 1. `--status` オプションの短縮形追加と動作修正

**問題**:
- `tm ls -s pending` が効果がなかった
- `-s` 短縮オプションが実装されていなかった
- `--status` でフィルタリングしても、後続の表示ロジックで除外されていた

**修正**:
- `--status` の短縮オプション `-s` を追加
- 明示的に `--status` でフィルタリングした場合は、他の表示ルールを無視するように変更

**ファイル**: `src/commands/list.ts`
- 29-33行目: `-s` 短縮オプションのパース処理を追加
- 60行目: `filterStatus` が指定されている場合は即座に `true` を返すように修正
- 13行目: ヘルプメッセージに `-s` を追加

### 2. `--head` / `--tail` オプションの追加

**機能**:
- `--head [N]`: 最初のN件を表示（デフォルト: 10件）
- `--tail [N]`: 最後のN件を表示（デフォルト: 10件）

**実装**:
- オプションのみ指定した場合: デフォルト値10を使用
- 数値を指定した場合: その数値を使用
- タスクとレビューの両方に適用される

**ファイル**: `src/commands/list.ts`
- 52-75行目: `--head` と `--tail` のパース処理
- 104-128行目: フィルタリング後のタスクとレビューに対してhead/tail処理を適用
- 17-18行目: ヘルプメッセージに説明を追加

## 使用例

```bash
# ステータスでフィルタリング
tm list --status pending
tm ls -s wip

# 最初の5件を表示
tm list --status-all --head 5

# 最後の10件を表示（デフォルト）
tm list --status-all --tail

# 組み合わせ
tm list --released --head 3
tm list --priority high --status pending --tail 5
```

## ドキュメント更新

以下のドキュメントを更新しました:

1. **src/index.ts**: メインヘルプメッセージを更新
2. **README.md**: `List Tasks` セクションにフィルタリングオプションの詳細を追加
3. **docs/usage/index.md**: タスク一覧表示のセクションを大幅に拡張

## テスト結果

すべてのオプションが正常に動作することを確認:

- ✅ `tm list -s pending` → pendingタスクが表示される
- ✅ `tm list --status pending` → pendingタスクが表示される
- ✅ `tm list --head 2` → 最初の2件が表示される
- ✅ `tm list --tail 2` → 最後の2件が表示される
- ✅ `tm list --head` → 最初の10件が表示される（デフォルト）
- ✅ `tm list --open --head 2` → オープンタスクの最初の2件が表示される

## 関連ファイル

- `src/commands/list.ts` (主要な変更)
- `src/index.ts` (ヘルプメッセージ)
- `README.md` (ユーザー向けドキュメント)
- `docs/usage/index.md` (詳細ガイド)
