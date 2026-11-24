# 次期バージョン（未リリース）

## New Features

（変更内容をここに記載）

## Bug Fixes

（変更内容をここに記載）

## Changes

（変更内容をここに記載）

## Performance

（変更内容をここに記載）

## Refactoring

（変更内容をここに記載）

## Repository Management

（変更内容をここに記載）

## Internal Improvements

- PR #49 / PR #53 由来の syncDir 回帰テスト3件（相対remote URL保持・insteadOfエイリアス不変・相対symlink保持）の `[covers:]` タグに対応する条件を `test/design/cross-platform-sync-dir.toml` へ追加し、verify-conditions.py の dangling tag (FAIL 3件) を解消。あわせて相対remote URL保持テストへ明示 pushurl の書き換えケースを追加 (TASK-23)

## Known Issues

（変更内容をここに記載）
