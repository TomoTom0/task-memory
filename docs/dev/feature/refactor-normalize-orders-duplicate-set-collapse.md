# リファクタリング: normalizeOrdersの重複検出をSetベースから直接扱う方式へ

## 現状

`src/utils/orderUtils.ts` の `normalizeOrders()` は、各親配下で使用されているorder数値を `Set<number>` で収集してから連番を振り直す実装になっている。同じorder値を持つタスクが複数あっても`Set`により1つに集約されるため、重複自体を解消できない。

この問題への対応として、`resolveDuplicateOrders()` という前処理関数を追加し、`normalizeOrders()`に渡す前に重複を微小な小数値へ分離する方式を採用した（TASK-40）。これにより`normalizeOrders()`本体は無変更のまま、既存の12件のテストを壊さずに重複解消を実現できた。

## 問題点

- `resolveDuplicateOrders()`は根本原因（`usedByParent`が`Set<number>`で重複を保持しないこと）を直さず、前段で回避する応急処置である
- 優先度（`recentlySetOrderIds`）を`saveTasks()`に渡すことを呼び出し側が忘れても、型レベル・APIレベルで強制する仕組みが無い。実際、`src/commands/release.ts`, `finish.ts`, `block.ts`, `close.ts`は`saveTasks(tasks)`を第二引数なしで呼んでいる
  - 現状は該当コマンドが実行後にstatusをtodo/wip以外へ変更するため、order自体がnullになり実害は無い
  - しかし将来的にtodo/wipのまま`--order`を扱う新しいコマンドが追加された場合、`recentlySetOrderIds`を渡し忘れると優先度が配列インデックス順にフォールバックし、意図しない挙動になりうる
- 小数オフセットは「勝者の値〜次の既存値」の区間に敗者を収める設計で衝突は理論的に回避されているが、浮動小数点の精度誤差や、非常に近い値が多数存在する場合の限界について厳密な検証は行っていない

## 改善案

- `normalizeOrders()`自体を、`Map<parentKey, Array<{index, priority}>>`のような、値だけでなく優先度と発生元インデックスを保持する構造に置き換え、`resolveDuplicateOrders()`という前処理層を無くして一本化する
- `saveTasks()`のシグネチャを見直し、`recentlySetOrderIds`を省略可能な第二引数ではなく、呼び出し側で明示が必要な形（例: 専用の`saveTasksWithOrder()`と、orderを変更しないコマンド用の`saveTasks()`を分離する等）にすることを検討する

## 優先度

low

## 関連

- タスク: TASK-40
- 関連ファイル: src/utils/orderUtils.ts, src/store.ts
