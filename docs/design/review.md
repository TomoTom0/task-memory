## into 
tm review からはじまるsubcommand を追加する

### command

- tm review new <title> --body <body>: 新しいレビューを依頼する
- tm review list: 既存のレビューを一覧表示する
- tm review get <review_id> [--history]: 特定のレビューを表示する
- tm review update <review_id> [--status <status> --body <body>]: 特定のレビューを更新する
- tm review return <review_id> [--status <status> --body <body>]: 特定のレビューに回答する

- tm review accept <review_id> [--new {tm newの続きにあたる内容} --new {複数のtaskをreviewに連動して起票可能}] [--add <existing_task_id>]: 特定のレビューを承認して、タスクを起票する。statusをdoneに変更する。これで起票されたタスクは連動するレビューidを持つ。
- tm review reject <review_id>: 特定のレビューを拒否する。statusをclosedに変更する。

## status
- todo: レビュー依頼中
- wip: レビュー中
- checking: レビュー完了後チェック待ち
- closed: レビュー結果を拒否してレビューを終了する
- done: レビュー結果を承認してレビューを終了する