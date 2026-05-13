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

## 関連

- PR: #7
- Thread ID: PRRT_kwDOQkMxZc5nif8t
- タスク: TASK-5 (closed)
- 関連ファイル: src/syncStore.ts
