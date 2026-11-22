# クロスプラットフォーム対応: 同期ディレクトリ

## 現状

同期ディレクトリとして `~/.local/task-memory` を使用している。
`.local` はLinuxの慣習であり、Windowsなどの他のOSでは一般的ではない。

## 問題点

- Windows環境では `~/.local` は標準的なパスではない
- macOSでは `~/Library/Application Support` が一般的
- 各OSで自然なファイルパスにデータを保存できていない

## 改善案

`env-paths` ライブラリを使用して、各OSの標準的なアプリケーションデータディレクトリを取得する。

```typescript
import envPaths from 'env-paths';

const paths = envPaths('task-memory');
const SYNC_DIR = paths.data;
// 例:
// Linux: ~/.local/share/task-memory
// macOS: ~/Library/Application Support/task-memory
// Windows: %APPDATA%\task-memory\Data
```

## 対応時の注意点

- 既存ユーザーのデータ移行が必要
- 移行スクリプトの作成を検討
- 設定でパスをカスタマイズできるようにすることも検討

## 優先度

medium

## 実装記録（2026-11-22、TASK-8）

実装済み。設計からの差異と実装仕様は以下のとおり:

- env-paths v4を導入（`envPaths('task-memory', { suffix: '' }).data`）。suffixを空にしないとディレクトリ名が `task-memory-nodejs` になる
- **設計との差異**: 設計書のWindows例は `%APPDATA%\task-memory\Data` だが、現行env-paths (v4) のdata pathは `%LOCALAPPDATA%\task-memory\Data`。委任タスクの指定（「env-pathsの規則どおり」）に従いライブラリ現行の規則を優先した
- 「設定でパスをカスタマイズできるようにすることも検討」（対応時の注意点）は未実装。需要が明確になってから別タスクで検討する

### 移行仕様（`migrateLegacySyncDir`、src/syncStore.ts）

- 発火地点: `tm sync` / `tm git` コマンドの入口と自動同期（`tryAutoSync`）の入口。毎回呼ばれるが冪等（旧dirが無ければ何もしない）
- 判定（`decideLegacySyncDirMigration`、純粋関数）:
  - 旧dir（`~/.local/task-memory`）が無い → 何もしない（新規ユーザー・移行済み）
  - 新dirが無い / 空dir → 旧dirを新dirへ移動（空dirはtmのデータではありえないため除去）
  - 両dirにデータがある → 移行せず警告（手動解決を促す）。既存の新パスデータの上書き事故・ファイル混入を防止
  - 旧dirにtmのデータ（`.git` / `projects` / `config.json`）が無い → 静かに無視（新dir優勢）
- 移動は `renameSync`、EXDEV（別ファイルシステム）時のみcopy+削除にfallback
- 移行成功時は新dir直下に `.migrated-from` marker（JSON: from / to / migratedAt）を残し、`.git/info/exclude`へ追加してgit追跡対象から外す

### テスト設計

- OS判定はenv-pathsに委譲しているため、実機がLinuxしかないことは (1) env-pathsのdata戻り値の差し替え（mock）でmacOS/Windows相当を与える (2) `XDG_DATA_HOME`で実解決を切り替える、の2段で吸収
- 条件書: `test/design/cross-platform-sync-dir.toml`（判定・実行・発火地点の15条件）

## 関連

- PR: #7
- Thread ID: PRRT_kwDOQkMxZc5nif8t
- タスク: TASK-8 (pending)（旧DBのTASK-5 (closed)から起票し直し。v0.6.0リリース時の棚卸しで保持を決定）
- 関連ファイル: src/syncStore.ts
