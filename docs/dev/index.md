# 開発者ガイド

`task-memory` の開発に参加するためのガイドです。

## 環境構築

- **Runtime**: Bun (v1.0以上推奨)
- **Language**: TypeScript

```bash
# 依存関係のインストール
bun install
```

## プロジェクト構成

```
src/
  commands/    # 各コマンドの実装
  store.ts     # JSONファイルへの読み書きロジック
  types.ts     # 型定義
  index.ts     # エントリーポイント
test/          # テストコード
docs/          # ドキュメント
```

## テストの実行

`bun:test` を使用しています。

```bash
bun test
```

## 設計思想

- **State Keeper**: 複雑なロジックを持たず、状態の保存と復元に徹する。
- **LLM Native**: 出力はJSONを基本とし、AIエージェントがパースしやすい形式にする。
- **Context-Aware**: `update` コマンドなど、文脈に応じた引数解析を行う。

## リリース手順

（将来的なnpm公開などの手順をここに記載）
