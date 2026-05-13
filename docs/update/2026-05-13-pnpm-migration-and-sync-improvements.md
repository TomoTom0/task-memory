# pnpm移行・sync改善 (2026-05-13)

## ビルド・テスト環境の移行

BunからNode.js標準ツールチェーンに移行しました。

- **パッケージマネージャー**: `bun install` → `pnpm install`
- **テストランナー**: `bun test` → `pnpm test` (vitest)
- **ビルド**: `bun build --compile` → `pnpm build` (tsup)
- **Node.js最小バージョン**: 18 → 22 (Active LTS)
- npm配布パッケージサイズ: 数十MB → 55KB

## sync ID の改善

`tm sync add` 時のデフォルト sync ID 生成ロジックを変更しました。

**変更前**: カレントディレクトリ名（マシンによって異なる可能性）

**変更後**: `git remote get-url origin` のURLから `owner-repo` 形式で生成

同じリモートリポジトリをクローンしたマシン間でデフォルト sync ID が一致するようになります。

## `tm sync set --id` コマンド追加

sync ID を変更するコマンドを追加しました。

```bash
tm sync set --id new-name
tm sync set --id new-name auto
```

## その他

- `store.ts` / `reviewStore.ts`: モジュールロード時のパスキャッシュを廃止し、呼び出しごとに `getDbPath()` を評価するよう変更（vitestでの並列テスト隔離に対応）
