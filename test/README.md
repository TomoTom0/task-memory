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
| `global-setup.ts` | 実データ不変guard（globalSetup/teardown。run前後で監視対象5点のhash比較） |
| `helpers.ts` | sandbox配下生成のシナリオ構築（createTempProject / getSandboxWorkDir / removeTempDir） |
| `setup.ts` | テスト隔離基盤（sandbox構築。全テストファイルのHOME・cwd差し替え） |

## テスト隔離（test/setup.ts）

隔離の唯一の担いは `test/setup.ts`（HOME差し替え・CODING_AGENT_ROOT/git参照系env削除・
GIT_*環境変数・sandbox cwdへのchdir）。**個別テストファイルは隔離コード（HOME差し替え・
env操作・os mock）を書かない**。sandbox構造・各設定の理由は `docs/design/test-isolation.md`
を参照する。

- 全テストファイルのHOME・cwdは `/tmp/tm-test-sandbox-*` 配下に限定され、実データ
  （repo側DB 2点・home側 3点）へは到達しない。sandboxはworker終了時（SIGTERM handler）
  に自己削除される
- 実データguard（`test/global-setup.ts`）がrun前後で監視対象5点（repo側2点+home側3点）の
  存在+内容hashを比較し、不一致ならrunをexit code 1で失敗させる（常設）
- **前提崩しオプションの注意**: `--no-isolate`、`--pool=threads`、`--singleFork`、
  `--no-file-parallelism` 等のfork/isolate前提を崩すCLI上書きは、sandboxの前提
  （テストファイルごとの独立workerでenv・cwdが初期化されること）を壊すためサポート外。
  config側で明示済みの値（`isolate: true`・`fileParallelism: true`・`singleFork: false`）を
  CLIで上書きして実行しない

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
