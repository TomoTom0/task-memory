# 次期バージョン（未リリース）

## New Features

（変更内容をここに記載）

## Bug Fixes

- `tm sync pull`: projects/外の追跡済みnested path（例: `local/settings.json`）がremoteの削除commit適用で親ディレクトリごと消えた場合、復元時の親ディレクトリ再生成がなくwriteFileSyncがENOENTで失敗し、pull済みのローカルファイルを復元できないままcommandが中断する問題を修正 (#46レビュー指摘 / TASK-12)
- `tm sync`: ローカルとremoteのgit既定branch名の不一致（例: ローカル `master`・空remoteのHEADは `main`）で最初のpushが行われたremoteで、2台目のcloneが何もcheckoutしない・自動adoptが拒否される・pullが `couldn't find remote ref HEAD` で失敗する問題を修正。remote側branchが1本だけならclone/adopt/pullがそれを自動採用し、pushはremote既定branch名が広告されている場合にローカルbranchをrenameしてremote HEADの指す先を埋める (#46レビュー指摘 / TASK-13)

## Changes

（変更内容をここに記載）

## Performance

（変更内容をここに記載）

## Refactoring

（変更内容をここに記載）

## Repository Management

（変更内容をここに記載）

## Internal Improvements

（変更内容をここに記載）

## Known Issues

（変更内容をここに記載）
