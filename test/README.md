# test 構成

vitestで実行する（`pnpm test`）。ファイルは `test/*.test.ts` にフラット配置する（このプロジェクトでは
`tests/`ではなく`test/`が既存の慣習であり、test-structure skillの`test/design/`もこれに合わせる）。

## テストファイル一覧

| ファイル | 対象 |
|---|---|
| `block.test.ts` | `tm block` / `tm unblock` |
| `close.test.ts` | `tm close` |
| `commit.test.ts` | `getCurrentCommit`、git repo内でのcommit hash取得 |
| `dispatch.test.ts` | `tm` コマンドのルーティング（index） |
| `docs.test.ts` | `tm docs` |
| `finish.test.ts` | `tm finish` |
| `get.test.ts` | `tm get` |
| `git_search.test.ts` | `findGitPath` |
| `global_mode.test.ts` | globalモード |
| `index.test.ts` | `isMainEntry`（symlink-aware direct invocation check）、`getHelpText` |
| `list.test.ts` | `tm list` |
| `new.test.ts` | `tm new` の引数パース |
| `orderUtils.test.ts` | `parseOrder` / `isValidOrderFormat` / `formatOrder` |
| `review.test.ts` | `tm review` |
| `statusGuard.test.ts` | `statusGuard` |
| `store.test.ts` | `saveTasks` のorder重複解消 |
| `sync.test.ts` | `syncStore` / `syncCommand`（`tm sync` サブコマンド群） |
| `update.test.ts` | `tm update` の引数パース、blocked/gate |

## test-structure（条件書によるテスト管理）

`test/design/*.toml` を条件書の正本として、機能ごとにテストが検証すべき条件（分岐・境界・優先順位・
外部I/O境界等）を管理する。運用の詳細・schema・執筆手順はskill `test-structure`（`~/.claude/skills/test-structure/SKILL.md`）を参照する。

- 条件には stable id（`<area>.<kebab-topic>`形式、例: `sync-clone.success`）を付与する
- テスト側は説明文に `[covers:<id>]` タグを付けて条件と紐付ける

  ```typescript
  it("[covers:sync-clone.success] bare remoteからcloneできる", () => {
    // ...
  });
  ```

- 検証は `python3 scripts/design/verify-conditions.py` で行う。id対応（dangling tag検出）・網羅検査・
  schema健全性・`source_lines`メタデータの自動同期・`[[excluded]]`構造健全性をチェックする
- `--strict-source` を付けると`source`欄の欠落もfailにする（全条件へのsource付与完了後に使う運用）

### 現状の適用範囲

- **test-structure管理下**: `sync-setup`機能のみ（`test/design/sync-setup.toml`、対応実装は
  `src/syncStore.ts` / `src/commands/sync.ts`。TASK-12で導入）
- **未移行**: 上記一覧の他のテストファイルはこの仕組みの対象外（bootstrap未実施）。既存テストからの
  移行はskill §7の手順（`--bootstrap`オプションでの土台抽出→要件起点での書き直し）に従う別タスクで
  行う

## 実行方法

```bash
pnpm test                                    # 全テスト
pnpm test -- test/sync.test.ts               # 単一ファイル
python3 scripts/design/verify-conditions.py  # 条件書の機械検証
```
