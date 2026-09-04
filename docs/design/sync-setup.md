# tm sync 初回セットアップ改善設計書

## 概要

`tm sync` の初回セットアップ（新規にremoteへ接続するPC-A、2台目以降のPC-B）の体験を改善する。

- 新subcommand `tm sync clone <url>`: 既存のremote sync repoを `~/.local/task-memory` へclone
- `tm sync add --remote <url>`: add時にremote originを設定
- `tm sync set --remote <url>`: remote originの設定・変更
- push/pullの状態事前検出と、次の一手を示すガイド
- `tm sync status` への remote URL 表示

## 背景・課題

現状の初回セットアップには以下の困難がある:

1. PC-B（2台目）では `~/.local/task-memory` を手で `git clone` する必要があり、CLIから案内されない
2. `tm sync push` はorigin未設定だとgit標準エラー（`fatal: 'origin' does not appear to be a git repository`）+ `Failed to push.` で終わり、対処法が示されない
3. PC-Bで `tm sync add` → `tm sync pull` すると、空のsync repoに対して `Warning: git pull failed.` + `Project "X" not found in sync repository.` となり、cloneすべきことが分からない
4. sync repoのremote URLをCLIから設定・確認する手段がない（`tm git remote add ...` を直接使う必要）

## 採用方針（確定済み）

1. `tm sync clone <url>`: `~/.local/task-memory` へのgit clone。既に `.git` が存在すればexit 1+ガイド、ディレクトリが存在して非gitならexit 1、成功時はprojects一覧と次の手順を表示。stdio inheritで認証をgitに委譲。clone先の親ディレクトリ（`~/.local`）が無い環境向けに事前作成する
2. `tm sync add --remote <url>`: initSyncRepo後、origin未設定なら `git remote add`。設定済みなら上書きせず警告+`set --remote` への案内。remote接続後、ローカルにcommitが1つも無ければ（=`add`のみでpush未実行の空repo）自動でremoteの内容をadoptする（下記6）
3. `tm sync set --remote <url>`: origin未設定なら `git remote add`、設定済みなら `git remote set-url` + 旧URL表示。remote接続後の自動adoptは2と同じ（下記6）
4. 状態検出: syncStore.tsに `getSyncRemoteUrl(): string | null` を追加。pushはorigin未設定を事前検出しexit 1+ガイド。pullはsync repo未初期化またはremote未設定かつ `projects/<id>.json` 無しでcloneを促すexit 1。pullFromSyncのProject not foundに `tm sync list` と `set --id` の案内を追記。statusに `Remote: <URL>|Not configured` 行を追加
5. docs/usage/index.md のsync章に初回セットアップ手順（PC-A/PC-B）を追記
6. **PC-Bが先に`add`した場合の復旧（自動adopt）**: `add --remote` / `set --remote` でremote接続が成立した直後、`hasSyncCommits()`（`git rev-parse --verify HEAD` の成否）がfalseなら、そのローカルrepoは`git init`直後でcommitが1つも無い（＝`push`未実行）ことが確定するため、`git fetch origin` → remoteのデフォルトブランチへ`git checkout -B <branch> origin/<branch>` を自動実行してremoteの内容を安全に取り込む（失うローカル履歴が無いため非破壊）。これにより「`add`→`set --remote`」だけで別PCとの復旧が完結し、従来案の「`set --remote`を案内するだけ」で終わるdead-endを解消する
7. 入力値検証: `--id` はパストラバーサル防止のため許可文字（英数・`.` `_` `-`）に制限し、解決パスが`projects/`配下にあることも検証する。git系コマンドへ渡すURLは先頭`-`を拒否し、オプション注入を防ぐ
8. `tm sync set` は副作用（remote変更・config保存）の前に全引数を検証し、一部だけ適用されて終了する状態を作らない
9. `tm sync push` の `git add .` は戻り値を確認し、失敗時は即exit 1（commit/pushへ進めない）

## 実装上の前提変更: sync repoパスの遅延計算

### 目的

`tm sync clone` のテストには「`~/.local/task-memory` が存在しない」状態が必須だが、開発機の実sync repoは破壊できない。またremote操作（remote add/set-url）のテストで実sync repoのoriginを書き換えることも許されない。

### 変更内容

`src/syncStore.ts` のモジュールレベル定数 `SYNC_DIR` / `PROJECTS_DIR` / `CONFIG_FILE` を削除し、呼び出し毎に計算する。`os.homedir()` はPOSIXで `$HOME` 環境変数を参照するため、テストから `process.env.HOME` を一時差し替えすることでsync repo全体をテスト用一時ディレクトリへ隔離できる（実行環境はLinux前提）。

```typescript
// 変更前
const SYNC_DIR = join(homedir(), '.local', 'task-memory');
const PROJECTS_DIR = join(SYNC_DIR, 'projects');
const CONFIG_FILE = join(SYNC_DIR, 'config.json');

// 変更後: 各関数の先頭で導出する
export function getSyncDir(): string {
    return join(homedir(), '.local', 'task-memory');
}
export function getProjectsDir(): string {
    return join(getSyncDir(), 'projects');
}
function getConfigFile(): string {
    return join(getSyncDir(), 'config.json');
}
```

影響する既存関数（いずれも関数内で `const syncDir = getSyncDir();` を取り直すのみ、シグネチャ不変）:

- `isSyncInitialized()` … `existsSync(syncDir)` && `existsSync(join(syncDir, '.git'))`
- `initSyncRepo()` … mkdir/git init/config.json/.gitignore の各パス
- `loadGlobalConfig()` / `saveGlobalConfig()` … CONFIG_FILE → `getConfigFile()`
- `getProjectFilePath()` … `join(getProjectsDir(), ...)`
- `pullFromSync()` / `listSyncedProjects()` … 同上
- `runGitCommand()` / `runGitCommandCapture()` … `cwd: getSyncDir()`

`generateSyncId()` は `process.cwd()`（プロジェクトrepo）基準のため変更なし。`src/commands/git.ts` は `getSyncDir()` / `runGitCommand` 経由のため変更不要。外部API（export関数のシグネチャ）に変化なし。

## syncStore.ts の新関数

### 型・シグネチャ

```typescript
export type SyncDirState = 'initialized' | 'not-git' | 'absent';

export function getSyncDirState(): SyncDirState;
// initialized: SYNC_DIR/.git が存在
// not-git:    SYNC_DIR は存在するが .git が無い
// absent:     SYNC_DIR が存在しない
// （isSyncInitialized() === (state === 'initialized') と同値）

export function getSyncRemoteUrl(): string | null;
// sync repoのorigin URLを返す。
// isSyncInitialized() がfalse、または runGitCommandCapture(['remote','get-url','origin'])
// のstatus !== 0、またはstdout.trim()が空文字 のいずれかなら null

export function isSafeGitUrl(url: string): boolean;
// url.length > 0 && !url.startsWith('-')
// git系コマンドへ渡す直前の全呼び出し箇所（clone/remote add/remote set-url）で使用し、
// 先頭'-'によるオプション注入（例: --upload-pack=...）を拒否する。

export function cloneSyncRepo(url: string): number;
// isSafeGitUrl(url) が false なら呼び出し側でガードする前提（この関数自体は呼ばれない）。
// mkdirSync(dirname(getSyncDir()), { recursive: true }) で親ディレクトリ（~/.local等）を先に作成
//（getSyncDir() 自体は事前作成しない。存在すると git clone が「既存ディレクトリへのclone」を拒否するため）。
// spawnSync('git', ['clone', '--', url, getSyncDir()], { stdio: 'inherit' })
// '--' でオプション終端し、認証プロンプト（HTTPSパスワード・SSH passphrase）をgitに委譲するため stdio: 'inherit' 固定。
// isSyncInitialized() のガードを持たない（clone時点でrepoは存在しないため）。
// result.status ?? 1 を返す。

export function ensureProjectsDir(): void;
// mkdirSync(join(getSyncDir(), 'projects'), { recursive: true })
// clone直後、cloned repoに projects/ が無い場合の保証（saveToSyncのwriteFileSync失敗防止）。

export function hasSyncProject(syncId: string): boolean;
// existsSync(getProjectFilePath(syncId))
// handlePull の状態検出用。commands層へのfs importを避けるためsyncStoreに置く。

export function hasSyncCommits(): boolean;
// isSyncInitialized() が false なら false。
// runGitCommandCapture(['rev-parse', '--verify', 'HEAD']).status === 0 を返す。
// falseは「git initはされたがcommitが1つも無い」状態（=push未実行）を意味し、
// remote接続時の自動adopt可否判定に使う。

export type AdoptResult =
    | { kind: 'adopted'; branch: string }
    | { kind: 'remote-empty' }
    | { kind: 'fetch-failed'; stderr: string }
    | { kind: 'checkout-failed'; stderr: string };

export function adoptRemoteIntoEmptyRepo(): AdoptResult;
// 前提: isSyncInitialized() && !hasSyncCommits() && getSyncRemoteUrl() !== null
//   （呼び出し側でこの3条件を満たす場合のみ呼ぶ）
//
// ブランチ解決（2回目レビュー指摘2対応）: `git branch -r` の先頭行はremoteのデフォルトブランチとは
// 限らない（表示順に依存し、保守用の古いブランチ等を誤採用しうる）ため、HEADのsymrefを明示的に解決する。
//
// 1. runGitCommandCapture(['ls-remote', '--symref', 'origin', 'HEAD'])
//    - 失敗（network/認証エラー等）→ { kind: 'fetch-failed', stderr }
//    - stdoutから `^ref: refs/heads/(\S+)\s+HEAD$` にマッチする行を探す。
//      マッチなし（remoteにHEADが無い＝ブランチもcommitも無い空repo）→ { kind: 'remote-empty' }
//    - マッチした `\1` を branch とする
// 2. runGitCommandCapture(['fetch', 'origin', branch]) が失敗 → { kind: 'fetch-failed', stderr }
// 3. ブートストラップファイルの除去（2回目レビュー指摘1対応。下記「ブートストラップファイルの扱い」参照）
// 4. runGitCommandCapture(['checkout', '-B', branch, `origin/${branch}`]) が失敗
//    （主因: `projects/` 配下の未commitなローカルデータがremote側の追跡ファイルと衝突。
//     ブートストラップファイルは3で既に除去済みのため、これは真に保護すべきローカルデータの衝突を意味する。
//     git自身が上書きを拒否するため非破壊）→ { kind: 'checkout-failed', stderr }
// 5. 成功 → { kind: 'adopted', branch }

export function isValidSyncId(id: string): boolean;
// /^[A-Za-z0-9._-]+$/.test(id) かつ id !== '.' && id !== '..'
// さらに resolve(getProjectFilePath(id)).startsWith(resolve(getProjectsDir()) + sep) を防御的に検証
//（許可文字制限のみだと将来の実装変更に弱いため、解決パスの二重チェックを行う）。
```

### ブートストラップファイルの扱い（2回目レビュー指摘1対応）

`initSyncRepo()` は `config.json` と `.gitignore` を無条件に生成する（[src/syncStore.ts:46-55](/home/tomo/work/app/cli/task-memory/src/syncStore.ts:46)）。PC-A側は `push` 時に `git add .` でこれらもcommit・remoteへpush済みのため、PC-Bが `add` 直後に同名の未追跡ファイルを持つ状態で `checkout -B` すると、git は「未追跡ファイルが上書きされる」として必ず失敗する。これは「`add`→`set --remote`で復旧完結」という本設計の主目的と両立しない致命的な欠陥だった。

3回目レビュー指摘（高）対応: 当初案は「内容を問わず削除」だったが、`.gitignore` は利用者が追記し得る・`config.json` も公開APIの `saveGlobalConfig()` 経由で書き換わり得るため、「削除して問題ない」という前提は成立しない。**削除ではなく、常にリネームで退避**する（内容の完全一致確認は将来のconfig.json形状変更に弱く不採用。退避なら内容を問わず無条件に非破壊）。

対処: `adoptRemoteIntoEmptyRepo()` のstep 3で、`config.json` と `.gitignore` の2ファイルに限り、**未追跡（`git status --porcelain` で `??` 判定）ならリネームして退避**してからcheckoutする。理由:

- リネームなら内容を一切判定する必要がなく、利用者がカスタマイズしていた場合でも失われない（削除ではなく退避のため常に復元可能）
- `projects/` 配下のファイル（利用者のタスクデータ）は一切対象にしない。ここに未追跡ファイルがあり衝突する場合は、意図どおりcheckoutが失敗し `checkout-failed` として明示的にユーザーへ通知する（黙って上書きしない）

4回目レビュー指摘（高）対応: `${path}.bak-${Date.now()}` は同一ミリ秒内の複数回実行や既存バックアップとの衝突時に `renameSync` の宛先が既存ファイルを上書きし得る（Linuxの`rename(2)`は宛先存在時に上書きする）。既存パスを避けて一意な退避名を採番する。加えて、退避ファイルが後続の `tm sync push` の `git add .` でremoteへcommitされないよう、`.git/info/exclude`（ローカル専用・sync対象外）へ除外パターンを追記する。

```typescript
// step 3実装（syncStore.ts内、adoptRemoteIntoEmptyRepo専用のプライベート処理）
function backupFilePath(path: string): string {
    let candidate = `${path}.bak-${Date.now()}`;
    let n = 1;
    while (existsSync(candidate)) {
        candidate = `${path}.bak-${Date.now()}-${n}`;
        n++;
    }
    return candidate;
}

function ensureBackupExcluded(): void {
    const excludePath = join(getSyncDir(), '.git', 'info', 'exclude');
    const pattern = '*.bak-*';
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    if (!current.split('\n').includes(pattern)) {
        writeFileSync(excludePath, current.replace(/\n?$/, '\n') + pattern + '\n', 'utf-8');
    }
}

const backedUp: string[] = [];
for (const name of ['config.json', '.gitignore']) {
    const path = join(getSyncDir(), name);
    const statusResult = runGitCommandCapture(['status', '--porcelain', '--', name]);
    if (statusResult.stdout.startsWith('??')) {
        const backupPath = backupFilePath(path);
        renameSync(path, backupPath);
        backedUp.push(backupPath);
    }
}
if (backedUp.length > 0) {
    ensureBackupExcluded();
    console.log(`Backed up local bootstrap files before adopting remote data: ${backedUp.join(', ')}`);
}
```

`backupFilePath` は宛先が既に存在する限りカウンタを増やして探索するため、`renameSync` が既存ファイルを上書きすることはない。`.git/info/exclude` はrepo間で共有されない（cloneでも複製されない）ローカル専用の除外設定のため、`.gitignore`（remoteとcommit対象として同期される）を書き換えるより適切。「追跡済み（既にcommit済み＝2回目以降の実行）」の場合は `??` にならないため退避されず、checkoutの通常の追跡ファイル更新に委ねられる。退避したバックアップファイルは自動削除しない（利用者が内容を見て手動で反映・削除する）。

指摘4（2回目レビュー）対応: CLI引数の検証（handleAdd/handleSetでの`isValidSyncId`呼び出し）だけでは、手編集された`config.json`や旧バージョンで作られた不正idがCLIの検証を経由せず到達するケースを防げない。そのため **データアクセス層（syncStore.ts）自体にも同じ検証を必須で入れる**:

- `saveToSync(syncId, store)` … 冒頭で `isValidSyncId(syncId)` をチェックし、falseなら `console.error('Invalid sync id: ...')` + `return false`（writeFileSyncへ進まない）
- `pullFromSync(syncId)` … 同様に冒頭でチェックし、falseなら `console.error(...)` + `return null`
- `hasSyncProject(syncId)` … 同様に冒頭でチェックし、falseなら `false` を返す（エラー出力は呼び出し側に委ねる）
- `tryAutoSync` は内部で `saveToSync` を呼ぶため、上記により自動的に保護される

これによりCLI層の検証（早期にわかりやすいエラーを出す目的）とstore層の検証（あらゆる呼び出し経路を防御する目的）の二層構成になる。既存の関数シグネチャ・戻り値の型は変化しない。

remote操作そのもの（`git remote add` / `git remote set-url`）は既存の `runGitCommandCapture` を使う（sync repo初期化済みが前提のためガードに抵触しない）。captureを使う理由: 成功時にgit側の出力を抑止し、CLI側のメッセージだけを出すため。失敗時はstderrを表示する。`git remote add origin <url>` / `git remote set-url origin <url>` はいずれも呼び出し前に `isSafeGitUrl(url)` で検証する。

### pullFromSync のメッセージ変更

`Project not found` に案内2行を追記する:

```typescript
console.error(`Project "${syncId}" not found in sync repository.`);
console.error('Run "tm sync list" to see available projects.');
console.error('Run "tm sync set --id <name>" to use a different ID for this project.');
```

## commands/sync.ts の変更

### handleClone（新規）

```typescript
function handleClone(positional: string[]): void
```

分岐フロー:

1. URLなし（`positional[0]` がundefined）→ usage error、exit 1
2. `!isSafeGitUrl(url)`（先頭'-'）→ usage error相当でexit 1（オプション注入対策）
3. `getSyncDirState() === 'initialized'` → exit 1 + ガイド（`set --remote` へ誘導）
4. `getSyncDirState() === 'not-git'` → exit 1（ディレクトリの撤去を促す）
5. `cloneSyncRepo(url)` の戻り値 !== 0 → exit 1（git自身のエラーはinheritで既に表示済み）
6. 成功: `ensureProjectsDir()` → clone済みprojects一覧表示 → 次の手順表示

メッセージ全文:

```
# 1. URLなし
Usage: tm sync clone <url>

# 2. 不正なURL
Invalid remote URL: "<url>" (must not start with "-").

# 3. already initialized
Sync repository already exists at: <SYNC_DIR>
To change the remote URL, run: tm sync set --remote <url>

# 4. ディレクトリ存在・非git
Directory exists but is not a git repository: <SYNC_DIR>
Remove or rename it, then run "tm sync clone <url>" again.

# 5. clone失敗
Failed to clone sync repository.

# 6. 成功時（標準出力）
Cloned sync repository to: <SYNC_DIR>

# projectsが1件以上ある場合
Synced projects:
  - <id>
  ...

# projectsが空の場合（代わり）
No projects found in the repository.

# 次の手順（固定）
Next steps:
  tm sync add --id <name>   Register the current project
  tm sync pull              Pull tasks for this project
```

projects一覧の書式は `handleList`（`Synced projects:` + `  - <id>`）と同一にする。

### handleAdd の変更

2回目レビュー指摘3対応: `parseArgs`（[src/commands/sync.ts:15-40](/home/tomo/work/app/cli/task-memory/src/commands/sync.ts:15)）は値が省略された`--opt`を`true`にし、未知のオプション名もそのまま`options`へ入れる。旧設計のまま`typeof === 'string'`だけで判定すると、値なし`--id`や未知オプション（例: `--id`をtypoした`--ids`）が無視されて処理が進んでしまう。そのため検証フェーズをhandleAdd冒頭（`ensureInitialized()`より前・副作用なし）にまとめ、許可オプション名のホワイトリストと値の有無を先に確認する。

3回目レビュー指摘（高）対応: `handleAdd` は従来 `positional` を受け取らず（`syncCommand`側で `handleAdd(options)` とのみ呼んでいた）、`tm sync add unexpected-arg` のような余分な位置引数を検証していなかった。`handleSet` と同様に `positional` を引数へ追加し、`positional.length > 0` を検証フェーズで拒否する。

```typescript
function handleAdd(positional: string[], options: Record<string, string | boolean>): void {
    // --- 検証フェーズ（副作用なし） ---
    if (positional.length > 0) {
        console.error(`Unexpected argument: ${positional[0]}`);
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    const allowedKeys = new Set(['id', 'save', 'remote']);
    for (const key of Object.keys(options)) {
        if (!allowedKeys.has(key)) {
            console.error(`Unknown option: --${key}`);
            console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
            process.exit(1);
        }
    }
    if (options.id === true) {
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    if (typeof options.id === 'string' && !isValidSyncId(options.id)) {
        console.error(`Invalid sync id: "${options.id}". Use only letters, digits, ".", "_", "-".`);
        process.exit(1);
    }
    if (options.remote === true) {
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    if (typeof options.remote === 'string' && !isSafeGitUrl(options.remote)) {
        console.error(`Invalid remote URL: "${options.remote}" (must not start with "-").`);
        process.exit(1);
    }

    // --- 実行フェーズ ---
    if (!ensureInitialized()) {
        console.error('Failed to initialize sync repository');
        process.exit(1);
    }

    if (typeof options.remote === 'string') {
        const url = options.remote;
        const current = getSyncRemoteUrl();
        if (current === null) {
            const result = runGitCommandCapture(['remote', 'add', 'origin', url]);
            if (result.status !== 0) {
                console.error('Failed to set remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin set to: ${url}`);
            applyAutoAdopt(); // 下記共通処理
        } else if (current === url) {
            console.log(`Remote origin already set to: ${url}`);
            applyAutoAdopt();
        } else {
            console.error(`Warning: remote origin is already set to: ${current}. Not overwriting.`);
            console.error('Run "tm sync set --remote <url>" to change it.');
        }
    }

    // 以降、既存の existingConfig チェック・config保存・--save 処理（不変。位置はこの直後）
    // ID採番のみ、3回目レビュー指摘（中）対応で以下のように変更する
}
```

3回目レビュー指摘（中）対応: `generateSyncId()`（[src/syncStore.ts:167-190](/home/tomo/work/app/cli/task-memory/src/syncStore.ts:167)）はプロジェクトディレクトリ名等をそのまま返すため、空白や日本語を含むディレクトリ名だと`isValidSyncId`を満たさないIDが自動生成されうる。`--id`未指定時に自動生成したIDも検証し、不正なら明示的な`--id`指定を促す:

```typescript
// 既存のID採番部分の変更（実行フェーズ、config保存の直前）
const syncId = (typeof options.id === 'string' ? options.id : null) || generateSyncId();
if (!isValidSyncId(syncId)) {
    console.error(`Auto-generated sync id "${syncId}" is invalid (derived from the directory/repo name).`);
    console.error('Run again with an explicit --id <name> (letters, digits, ".", "_", "-" only).');
    process.exit(1);
}
```

`--id` を明示指定した場合は検証フェーズで既に`isValidSyncId`を通過済みのため、ここでの再チェックは自動生成ケースのみで実質的に効く。`--save` は既存どおり値の有無を問わず truthy 判定（`options.save`）のまま不変。上書きはしない（警告のみで継続、exit 0）。`applyAutoAdopt()` は下記「remote接続時の自動adopt（共通処理）」を参照。

### remote接続時の自動adopt（共通処理）

`commands/sync.ts` 内のモジュールプライベート関数として実装し、handleAdd・handleSetの両方から呼ぶ（syncStoreではなくcommands層に置く理由: console出力を伴うため）。

```typescript
function applyAutoAdopt(): void {
    if (hasSyncCommits()) {
        return; // 既にcommitがある = 復旧対象ではない（何もしない）
    }
    const result = adoptRemoteIntoEmptyRepo();
    switch (result.kind) {
        case 'adopted':
            console.log(`Adopted existing data from remote. (branch: ${result.branch})`);
            break;
        case 'remote-empty':
            console.log('Remote repository has no commits yet. Run "tm sync push" to publish local data.');
            break;
        case 'fetch-failed':
            console.error('Failed to fetch from remote.');
            console.error(result.stderr);
            process.exit(1);
            break;
        case 'checkout-failed':
            console.error('Local files conflict with the remote content and could not be adopted automatically.');
            console.error(result.stderr);
            console.error(`Resolve manually in ${getSyncDir()}, then run "tm sync pull".`);
            process.exit(1);
            break;
    }
}
```

`fetch-failed` / `checkout-failed` でexit 1する場合もremote origin自体の設定は既に完了しているため、config状態は変化しない（再実行可能）。

### handleSet の変更

`--remote` はsync repo（グローバル）への操作でありプロジェクトのsync設定に依存しない。そのため **syncConfig.enabledを要求しない**（PC-Bでclone直後・未addの状態でもremote確認・変更を可能にする）。`--id` / `auto|manual` は従来どおりenabledを要求する。

指摘5対応: 副作用（remote変更・config保存）より前に全引数を検証する。`tm sync set --remote <url> invalid-mode` のように後段の引数が不正な場合、remoteだけ変更されて終了する部分適用を避ける。

2回目レビュー指摘3対応: 検証フェーズは「値の型が合っているか」だけでなく「引数の形そのもの」も見る必要がある。`parseArgs`の仕様上、値なし`--id`は`options.id === true`になり、未知のオプション名もそのまま`options`に入り、位置引数は`positional`に何個でも積まれる。旧設計はこれらを無視して通してしまっていたため、以下を追加する:

- 許可オプション名のホワイトリスト（`id` / `remote`）以外を拒否
- `options.id === true`（値なし`--id`）を拒否
- `positional.length > 1`（`auto invalid` のような余分な位置引数）を拒否

再構成後のフロー:

```typescript
function handleSet(positional: string[], options: Record<string, string | boolean>): void {
    // --- 検証フェーズ（副作用なし） ---
    const allowedKeys = new Set(['id', 'remote']);
    for (const key of Object.keys(options)) {
        if (!allowedKeys.has(key)) {
            console.error(`Unknown option: --${key}`);
            console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
            process.exit(1);
        }
    }
    if (positional.length > 1) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }

    if (options.remote === true) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }
    const remoteUrl = typeof options.remote === 'string' ? options.remote : null;
    if (remoteUrl !== null && !isSafeGitUrl(remoteUrl)) {
        console.error(`Invalid remote URL: "${remoteUrl}" (must not start with "-").`);
        process.exit(1);
    }

    if (options.id === true) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }
    if (typeof options.id === 'string' && !isValidSyncId(options.id)) {
        console.error(`Invalid sync id: "${options.id}". Use only letters, digits, ".", "_", "-".`);
        process.exit(1);
    }

    const mode = positional[0];
    if (mode !== undefined && mode !== 'auto' && mode !== 'manual') {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }

    const hasIdOrMode = typeof options.id === 'string' || mode === 'auto' || mode === 'manual';
    if (remoteUrl === null && !hasIdOrMode) {
        // 何も指定が無い（従来のusage error相当）
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }

    const syncConfig = loadSyncConfig();
    if (hasIdOrMode && !syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    // --- 実行フェーズ ---
    if (remoteUrl !== null) {
        if (!ensureInitialized()) {
            console.error('Failed to initialize sync repository');
            process.exit(1);
        }
        const current = getSyncRemoteUrl();
        if (current === null) {
            const result = runGitCommandCapture(['remote', 'add', 'origin', remoteUrl]);
            if (result.status !== 0) {
                console.error('Failed to set remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin set to: ${remoteUrl}`);
        } else {
            const result = runGitCommandCapture(['remote', 'set-url', 'origin', remoteUrl]);
            if (result.status !== 0) {
                console.error('Failed to update remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin changed: ${current} -> ${remoteUrl}`);
        }
        applyAutoAdopt();
    }

    if (hasIdOrMode && syncConfig) {
        if (typeof options.id === 'string') {
            syncConfig.id = options.id;
            console.log(`Sync ID set to: ${options.id}`);
        }
        if (mode === 'auto' || mode === 'manual') {
            syncConfig.auto = mode === 'auto';
            console.log(`Sync mode set to: ${mode}`);
        }
        saveSyncConfig(syncConfig);
    }
}
```

既存のusage error文言は `--remote` を含む形に更新する。`--id` / mode の指定があるにもかかわらず未同期（enabled=false）の場合は、検証フェーズの時点で（remote処理を実行する前に）`Not synced. Run "tm sync add" first.` でexit 1する（従来はremote処理の後にチェックしていたが、指摘5対応により副作用の前に統一）。

### handlePush の変更

関数先頭の `Not synced` チェックの直後に、origin未設定の事前検出を追加（save/commitより前のfail-fast。失敗時にローカルを変更しない）:

```typescript
const remoteUrl = getSyncRemoteUrl();
if (remoteUrl === null) {
    console.error('Remote origin is not configured.');
    console.error('Run "tm sync add --remote <url>" or "tm sync set --remote <url>" to configure it.');
    process.exit(1);
}
```

指摘7対応: `git add .` の戻り値を確認し、失敗時はcommit/pushへ進まずexit 1する（現行は戻り値未確認でcommitへ進んでいた）。

```typescript
// git add
const addStatus = runGitCommand(['add', '.']);
if (addStatus !== 0) {
    console.error('Failed to stage changes.');
    process.exit(1);
}
```

以降のsave → add → commit → pushは、上記add確認を除いて不変。

### handlePull の変更

既存の `Not synced` チェックの直後に状態検出を追加する。方針4の「cloneを促す」は、cloneが実際に成功しうる「sync repo未初期化」ケースに適用する。初期化済み・remote未設定・ローカルにデータ無しのケースではcloneは既に `.git` 存在で拒否されるため、救済可能な `set --remote` を案内する（cloneへの誘導はdead-endになるため）。`set --remote` 自体が方針6の自動adoptにより実際にデータを取得するため、この案内はdead-endではなく実際に解決する手順になる。

```typescript
// 条件1: sync repo未初期化
if (!isSyncInitialized()) {
    console.error('Sync repository is not initialized on this machine.');
    console.error('If you have a remote sync repository, run: tm sync clone <url>');
    console.error('Otherwise, run: tm sync add --save to start a new one.');
    process.exit(1);
}

// 条件2: remote未設定 かつ projects/<id>.json 無し（pullしても取得元が無い）
const remoteUrl = getSyncRemoteUrl();
if (remoteUrl === null && !hasSyncProject(syncConfig.id)) {
    console.error(`No remote is configured and no local data exists for project "${syncConfig.id}".`);
    console.error('Run "tm sync set --remote <url>" to connect a remote repository, then "tm sync pull".');
    process.exit(1);
}
```

条件2の補足: remote未設定でも `projects/<id>.json` がローカルに存在する場合（remote無しのローカル運用）は従来どおり `git pull` 失敗のwarning → ローカルデータでpullが完了する。この経路を壊さない。

以降の `git pull --rebase` → `pullFromSync` → merge/上書き処理は不変。

### handleStatus の変更

`Initialized:` 行の直後に1行追加:

```typescript
console.log(`Remote: ${getSyncRemoteUrl() ?? 'Not configured'}`);
```

未初期化時は `getSyncRemoteUrl()` がnullを返すため `Remote: Not configured` となる。

### showHelp の更新

```
Usage: tm sync <subcommand> [options]

Subcommands:
  clone <url>             Clone a remote sync repository to ~/.local/task-memory
  add [--id <name>] [--save] [--remote <url>]
                          Add current project to sync
  remove                  Remove current project from sync
  save                    Save tasks to sync directory
  push                    Push sync directory to remote
  pull [--merge]          Pull tasks from sync repository
  set [--id <name>] [--remote <url>] [auto|manual]
                          Set sync ID, remote URL, and/or mode
  status                  Show sync status
  list                    List synced projects

Examples:
  tm sync clone https://github.com/user/task-memory-sync.git
  tm sync add --id my-project --save --remote https://github.com/user/task-memory-sync.git
  tm sync push
  tm sync pull --merge
  tm sync set --remote https://github.com/user/task-memory-sync.git
```

### syncCommand のswitchに追加

```typescript
case 'clone':
    handleClone(positional);
    break;
```

`handleAdd` の呼び出し（既存の `case 'add': handleAdd(options); break;`）も `handleAdd(positional, options)` へ変更する（3回目レビュー指摘対応でシグネチャが変わるため）。

## src/index.ts の変更

`getHelpText()` のsync行のsubcommand一覧に `clone` を追加（他は不変）:

```
  sync <subcommand> [options]
    Sync tasks to ~/.local/task-memory/ repository.
    Subcommands: clone, add, remove, push, pull, set, status, list
```

`dispatch()` は `sync` → `syncCommand` の委譲のため変更不要。

## ドキュメント変更

### docs/usage/index.md（sync章）

sync章の冒頭（「初期設定」の前）に「初回セットアップ」節を追加:

```markdown
### 初回セットアップ

PC-A（最初の1台）:

```bash
# syncに追加しつつremoteを設定（privateな空repoのURLを指定）
tm sync add --id my-project --save --remote <url>

# リモートにpush
tm sync push
```

PC-B（2台目以降）:

```bash
# 既存のsync repoをclone
tm sync clone <url>

# 現在のプロジェクトをsyncに登録（PC-Aと同じIDを指定）
tm sync add --id my-project

# タスクを取得
tm sync pull
```
```

さらに:

- 「初期設定」節のadd例に `--remote <url>` を追記
- 「sync IDの変更」節を「sync ID・remote・モードの変更」に改題し、`tm sync set --remote <new-url>`（旧URLの表示付き変更）を追記
- 「状態確認」節に `tm sync status` の `Remote:` 行の説明を追記
- remote未設定時の `tm sync push` / `tm sync pull` がガイド付きでexit 1することの注記

### docs/README.md

`design/` のドキュメント一覧に `sync-setup.md` を追記。

### docs/usage/agent-claude-md.md

syncへの言及は `tm sync pull` のguard対象外注記1行のみでsubcommand一覧は無いため、変更不要。

## ファイル変更一覧

1. `src/syncStore.ts` - パス遅延計算化、新関数9件（getSyncDirState / getSyncRemoteUrl / isSafeGitUrl / cloneSyncRepo / ensureProjectsDir / hasSyncProject / hasSyncCommits / adoptRemoteIntoEmptyRepo / isValidSyncId）、pullFromSyncメッセージ追記。importに `dirname`（'path'、cloneSyncRepoの親ディレクトリ作成用）、`renameSync`（'fs'、ブートストラップファイル退避用）を追加
2. `src/commands/sync.ts` - handleClone新規、applyAutoAdopt新規（共通処理）、handleAdd（シグネチャに`positional`追加）/handleSet/handlePush/handlePull/handleStatus変更、showHelp更新、switchにclone追加（handleAdd呼び出しも`handleAdd(positional, options)`へ変更）
3. `src/index.ts` - getHelpTextのsync行にclone追記
4. `test/sync.test.ts` - テスト追加（下記）
5. `test/index.test.ts` - getHelpTextにcloneが含まれることの検証を追加
6. `docs/usage/index.md` - sync章に初回セットアップ手順・オプション説明を追記
7. `docs/README.md` - design/一覧に本ドキュメントを追記
8. `package.json` - 変更なし（scripts・bin不変）

## テスト設計

既存 `test/sync.test.ts` の方式（実コマンド実行・console.log差し替えキャプチャ・process.exitスタブ・afterEachで生成物削除）に合わせる。remote操作の検証にはlocal bare repoを使用する（実remoteへの検証操作は禁止）。

### テスト隔離（HOME差し替え）

指摘6対応: 既存describeブロックが実HOMEの `~/.local/task-memory` を操作し続ける設計は、新設ブロックの隔離方針と矛盾し保証が弱いため、`test/sync.test.ts` の最上位（全describeブロックを包む）でHOME差し替えを行う。個別のdescribeごとに差し替えを重複実装しない。

```typescript
// test/sync.test.ts の先頭、既存describe群より外側
let originalHome: string | undefined;
let homeDir: string;

beforeEach(() => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true }); // クリーンチェックアウト対応
    originalHome = process.env.HOME;
    homeDir = mkdtempSync(join(process.cwd(), 'tmp', 'sync-test-home-'));
    process.env.HOME = homeDir;
});

afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(homeDir, { recursive: true, force: true });
});

// 既存describe群・新設describe群はすべてこのbeforeEach/afterEachの内側で動く
```

`beforeEach`/`afterEach` はvitestが例外・アサーション失敗時にも必ず実行する（try/finally相当の保証）。os.homedir() はPOSIXで `$HOME` を参照するため、getSyncDir() の遅延計算と組み合わせてsync repo全体が隔離される。一時ディレクトリは命名規則に従い `./tmp/` 配下に作成し、親 `tmp/` が無いクリーンチェックアウトでも失敗しないよう毎回 `mkdirSync(..., { recursive: true })` してから `mkdtempSync` する。

### 補助処理（describe内ローカル関数）

- `createBareRemote(): string` … `spawnSync('git', ['init', '--bare', <tmp>/remote.git])` でlocal bare repoを作成し、そのパスを返す
- remote側にデータを用意する場合は、work cloneを作成し `git -c user.email=test@example.com -c user.name=test commit` でcommit → push（環境のgit設定に依存しない）
- console.logキャプチャ・process.exitスタブは既存のインライン方式を踏襲

### clone のテスト観点

1. 成功: bare remoteに `projects/foo.json` をcommit済みの状態で `syncCommand(['clone', remotePath])` → `.git` と `projects/foo.json` が存在、`getSyncRemoteUrl() === remotePath`、ログに `Cloned sync repository to:` / `Synced projects:` / `  - foo` / `Next steps:` が含まれる。HOME差し替えにより `~/.local` 自体が存在しない状態から実行されるため、指摘2（clone先親ディレクトリ未作成での失敗）の回帰確認を兼ねる
2. URLなし: `syncCommand(['clone'])` → exit 1、`Usage: tm sync clone <url>`
2a. 不正なURL（単一`-`始まりのオプション注入対策）: `syncCommand(['clone', '-oProxyCommand=touch /tmp/pwned'])` → exit 1、`Invalid remote URL:`。cloneが実行されないこと（`~/.local/task-memory` 未作成）を確認。4回目レビュー指摘（中）対応: `positional`（`arg?.startsWith('--')`で判定される`parseArgs`）に積まれるのは`--`始まりでない値のみのため、検証対象は単一`-`始まりの値になる（add/setの10b/16dと同じ理由）
2b. `--`始まりの値（parseArgsの構造上の防御確認）: `syncCommand(['clone', '--upload-pack=touch /tmp/pwned'])` → exit 1、`Usage: tm sync clone <url>`（`--`始まりの値はoptionとして吸収され`positional[0]`が`undefined`のまま「URLなし」のstep 1に該当するため。`Invalid remote URL:`にはならないことの回帰確認）
3. 初期化済み: `initSyncRepo()` 後にclone → exit 1、`Sync repository already exists at:` と `tm sync set --remote` のガイド。originは変化しない
4. ディレクトリ存在・非git: `~/.local/task-memory` を `.git` 無しで作成 → exit 1、`not a git repository` メッセージ
5. clone失敗: 存在しないパスをURLに指定 → exit 1、`Failed to clone sync repository.`（network不要で失敗する）

### add --remote のテスト観点

6. 未設定 → 設定: `syncCommand(['add', '--id', 'x', '--remote', url])` → `getSyncRemoteUrl() === url`、ログに `Remote origin set to: <url>`。store.syncも通常どおり設定される
7. 別URL設定済み: 先にremote addしておき `--remote <別url>` → 警告2行（`Warning: remote origin is already set to:` / `Run "tm sync set --remote <url>" to change it.`）、originは不変
8. 同URL設定済み: `Remote origin already set to: <url>` の情報メッセージ、exitしない
9. 値なし `--remote`: `syncCommand(['add', '--remote'])` → exit 1、usage
10. `--remote` なしのadd（回帰）: `syncCommand(['add', '--id', 'x', '--save'])` → originは設定されない（`getSyncRemoteUrl() === null`）
10a. 不正な `--id`: `syncCommand(['add', '--id', '../../evil'])` → exit 1、`Invalid sync id:` を含む。`getProjectFilePath` が呼ばれない（副作用なし）ことをファイル未作成で確認
10b. 不正な `--remote`（単一`-`始まりのオプション注入）: `syncCommand(['add', '--id', 'x', '--remote', '-oProxyCommand=touch /tmp/pwned'])` → exit 1、`Invalid remote URL:` を含む。`git remote` が実行されないこと（`getSyncRemoteUrl() === null`）を確認。3回目レビュー指摘（中）対応: 値が`--`始まり（例: `--upload-pack=...`）の場合は`parseArgs`自身が`options.remote === true`＋別の未知オプションとして分解するため、`Unknown option:`側で先に弾かれ`isSafeGitUrl`には到達しない（10eで別途確認）。isSafeGitUrlが実際に効くのは単一`-`始まりの値のみのため、本ケースの攻撃例もそれに合わせる
10c. 値なし `--id`（指摘3・2回目）: `syncCommand(['add', '--id'])` → exit 1、usage。`initSyncRepo()` 等の副作用が起きないこと（検証フェーズがensureInitializedより前にあることの確認）
10d. 未知オプション（指摘3・2回目）: `syncCommand(['add', '--id', 'x', '--unknown', 'y'])` → exit 1、`Unknown option: --unknown`。config保存等の副作用が起きないこと
10e. `--`始まりのURL値（parseArgsの構造上の防御確認）: `syncCommand(['add', '--id', 'x', '--remote', '--upload-pack=touch /tmp/pwned'])` → exit 1、`Unknown option: --upload-pack=touch /tmp/pwned` を含む（`options.remote`はtrueになり別トークンが未知オプション扱いされるため）。結果としてremoteは変更されない（`getSyncRemoteUrl() === null`）ことを確認
10f. 余分な位置引数（指摘3・3回目、handleAddへのpositional追加対応）: `syncCommand(['add', 'unexpected', '--id', 'x'])` → exit 1、`Unexpected argument: unexpected`。config保存等の副作用が起きないこと
10g. 自動生成idの検証（指摘4・3回目）: `generateSyncId()` が空白を含む文字列（例: プロジェクトディレクトリ名が `my project`）を返す状況を再現し、`--id` を指定せず `syncCommand(['add'])` → exit 1、`Auto-generated sync id "my project" is invalid` を含む。configが保存されないこと（`loadSyncConfig()?.enabled` が false のまま）を確認

### set --remote のテスト観点

11. 未設定 → 設定: `syncCommand(['set', '--remote', url])` → origin設定、`Remote origin set to: <url>`
12. 未同期プロジェクトでも成功: storeを `{tasks: []}`（sync無効）にして `set --remote` → exitせずorigin設定（enabledを要求しない仕様の固定）
13. 変更: 別URL設定済みで `set --remote <new>` → `getSyncRemoteUrl() === new`、ログに `Remote origin changed: <old> -> <new>`
14. 併用: `syncCommand(['set', '--id', 'new-id', '--remote', url, 'auto'])` → origin・id・autoすべて適用
15. 引数なし（回帰）: `syncCommand(['set'])` → exit 1、usage（`--remote` を含む文言に更新）
16. 未同期でid指定: storeをsync無効にして `set --id x` → exit 1、`Not synced.`（既存挙動の維持）
16a. 検証優先（指摘5）: 別URL設定済みの状態で `syncCommand(['set', '--remote', newUrl, 'invalid-mode'])` → exit 1、usageメッセージ。かつ `getSyncRemoteUrl()` が旧URLのまま変化していないこと（remoteへの副作用が起きていないことを確認する本ケースの主眼）
16b. 未同期 + remote併用: storeをsync無効にして `syncCommand(['set', '--remote', url, '--id', 'x'])` → exit 1、`Not synced.`。かつremoteも変更されていないこと（検証フェーズで先に弾かれる）
16c. 不正な `--id`: `syncCommand(['set', '--id', 'a/../b'])` → exit 1、`Invalid sync id:`
16d. 不正な `--remote`（単一`-`始まり。isSafeGitUrlが実際に到達する例。3回目レビュー指摘（中）で10bと合わせて確認済み）: `syncCommand(['set', '--remote', '-oProxyCommand=touch /tmp/pwned'])` → exit 1、`Invalid remote URL:`
16i. 値なし `--id`（指摘3・2回目）: 同期済み状態で `syncCommand(['set', '--id'])` → exit 1、usage。configが変化していないこと
16j. 未知オプション（指摘3・2回目）: `syncCommand(['set', '--remote', url, '--unknown', 'y'])` → exit 1、`Unknown option: --unknown`。remoteも変更されていないこと（検証フェーズが実行フェーズより前にあることの確認）
16k. 余分な位置引数（指摘3・2回目）: `syncCommand(['set', 'auto', 'extra'])` → exit 1、usage。modeも変更されていないこと

### 自動adopt（applyAutoAdopt）のテスト観点

16e. PC-B復旧E2E（指摘1の主眼・2回目レビューで再修正）: bare remoteでwork cloneを作り、`config.json` を含む形で `git add . && git commit && push`（PC-Aの`push`が実際に生成する内容を再現）。ローカルでは `syncCommand(['add', '--id', 'shared'])`（remote無し・`initSyncRepo()`由来の未追跡`config.json`/`.gitignore`が存在し、commitも無い状態）→ 続けて `syncCommand(['set', '--remote', remotePath])` → ログに `Adopted existing data from remote.` を含み、`hasSyncProject('shared') === true`。以後 `syncCommand(['pull'])` がexitせず成功する。**本ケースはブートストラップファイル除去（`config.json`/`.gitignore`の未追跡時削除）が無いと`checkout -B`が失敗して再現しないため、その除去ロジックの直接的な回帰確認を兼ねる**
16e2. 非main/masterブランチの解決（指摘2・2回目）: bare remoteのデフォルトブランチを `trunk` 等main/master以外の名前で作成し、他に古い保守用ブランチ（例: `legacy`）も存在する状態で16eと同じ手順を実行 → `origin/legacy` ではなく `origin/trunk`（remoteのHEAD symrefが指す方）がadoptされること（`git -C <SYNC_DIR> branch --show-current === 'trunk'`）を確認。`git branch -r` の表示順に依存する誤adoptが再発しないことの回帰確認
16f. remoteが空: bare remoteをcommit無しで作成 → `add --remote <bare>` → ログに `Remote repository has no commits yet.`、exitしない
16g. 衝突で失敗（真のローカルデータとの衝突）: `projects/shared.json`（未commit・remoteと同名で内容異なる。ブートストラップファイルではなく実データ）を用意した状態でremote接続 → `checkout -B` が失敗する状況を再現し、exit 1・`could not be adopted automatically` を含む。ローカルファイルが変更されず残っていることを確認（非破壊の確認）。`config.json`/`.gitignore`は削除対象だがこのファイルは対象外であることの区別を確認
16h. 既にcommitあり（復旧対象外）: `add --remote` → `push` で1コミット作成済みの状態から `set --remote <別url>` → adoptは走らない（`hasSyncCommits() === true` のため）。従来の `Remote origin changed:` メッセージのみ
16l. store層のid防御（指摘4・2回目）: `syncCommand(['add', '--id', 'x', '--save'])` で同期を有効化した後、`loadSyncConfig()`/`saveSyncConfig()`を直接使わずconfig.json相当のファイルを手編集する体で `syncConfig.id = '../evil'` を注入した状態を作り、`saveToSync('../evil', store)` / `pullFromSync('../evil')` / `hasSyncProject('../evil')` を直接呼ぶ → CLI層を経由せずとも `false` / `null` / `false` を返し、`projects/`外へのファイル操作が起きないことを確認（CLI検証をバイパスする経路の防御確認）

### push のテスト観点

17. origin未設定: `add` 済み・origin無しで `syncCommand(['push'])` → exit 1、`Remote origin is not configured.` とガイド。sync repoにcommitが作られていないこと（fail-fastの確認）
18. origin設定済みのE2E: bare remoteに対して `add --remote` → `push` → exitせず、bare remote側にcommitが存在（`git -C <remote> rev-parse HEAD` 成功）し、`projects/<id>.json` が届いている
18a. `git add` 失敗（指摘7）: sync repoの `.git` を意図的に壊す等で `git add .` が失敗する状況を再現 → exit 1、`Failed to stage changes.`。commit・pushが実行されていないこと（bare remoteにcommitが届いていないこと）を確認

### pull のテスト観点

19. 未初期化: storeにsync設定のみ（initSyncRepoしない）で `syncCommand(['pull'])` → exit 1、`Sync repository is not initialized on this machine.` と `tm sync clone <url>` ガイド
20. 初期化済み・remote無し・データ無し: `initSyncRepo()` + `add` の後 `pull` → exit 1、`No remote is configured and no local data exists` と `tm sync set --remote` ガイド
21. 初期化済み・remote無し・データあり（回帰）: `add --save` でローカルに `projects/<id>.json` を作ってから `pull` → 従来どおり警告のみでpullが完了（exitしない）
22. clone経由のE2E: remoteにデータがある状態でclone → `add --id <同ID>` → `pull` → ローカルstoreにremoteのタスクが反映
23. pullFromSyncのnot-found案内: `initSyncRepo()` して `pullFromSync('ghost')` → `Project "ghost" not found in sync repository.` に加え `tm sync list` と `tm sync set --id` の案内行

### status / getSyncRemoteUrl / isValidSyncId / isSafeGitUrl / help のテスト観点

24. `getSyncRemoteUrl()`: 未初期化でnull、初期化のみでnull、remote add後はURL
25. `syncCommand(['status'])`: origin未設定で `Remote: Not configured`、設定後は `Remote: <url>` を含む
26. `syncCommand(['help'])`: `clone <url>` と `--remote <url>` を含む
27. `test/index.test.ts`: `getHelpText()` が `clone` を含む（subcommand一覧の更新確認）
28. `isValidSyncId()`: `'my-project'` `'v1.2_x'` → true。`'../x'` `'a/b'` `'.'` `'..'` `''` → false
29. `isSafeGitUrl()`: `'https://example.com/x.git'` `'git@example.com:x.git'` → true。`'-oProxyCommand=x'` `'--upload-pack=x'` `''` → false

### 既存テストへの影響

HOME差し替えをファイル全体のbeforeEach/afterEachに変更したことで、既存テストも隔離済みHOME配下で実行される。既存テストは自テスト内で `initSyncRepo()` 等を呼んで状態を作ってから検証しており、実HOMEの既存内容に依存する記述はないため、挙動・アサーションの変更は不要（隔離先が変わるだけ）。既存テストの実行前後で実機の `~/.local/task-memory` に一切触れなくなる点が、旧設計（新設ブロックのみ隔離）からの改善点。

## 後方互換性の確認項目

| 対象 | 確認事項 |
|---|---|
| `tm sync add` | `--remote` なしの呼び出しでremoteに触れないこと（観点10）。引数・exit code不変。破壊的変更点: `--id` に英数・`.` `_` `-` 以外を含む呼び出しは新たにexit 1になる（従来は無検証で通っていた。パストラバーサル対策のため意図的な制限。観点10a）。破壊的変更点: 値なし`--id`（観点10c）・未知オプション（観点10d）も新たにexit 1になる（従来は無視されて処理が進んでいた） |
| `tm sync set` | `--id` / `auto` / `manual` の挙動・メッセージ不変。引数なしのusage error（exit 1）不変。緩和点: 未同期でも `set --remote` 単体が成功するようになる（従来はexit 1。観点12で仕様として固定）。破壊的変更点: `--id` の文字制限は add と同様に新設（観点16c）。挙動変更点: `--id`/mode が不正な場合、remoteの副作用が発生する前にexit 1するようになる（従来はremote処理が先だったため部分適用が起きていた。観点16a・16b）。破壊的変更点: 値なし`--id`（観点16i）・未知オプション（観点16j）・2個以上の位置引数（観点16k）も新たにexit 1になる |
| `tm sync push` | origin設定済みなら挙動不変。未設定時もexit code は従来同様1（メッセージが明示的なガイドに変わるのみ）。`git add .` 失敗時に限り新たにexit 1（従来は無視してcommitへ進んでいた不具合の修正。観点18a） |
| `tm sync pull` | remote・ローカルデータのいずれかが利用可能なら挙動不変（観点21・22）。`--merge` は無影響 |
| `tm sync save` / `remove` / `list` / `status` | save/remove/listは無変更。statusは `Remote:` 行の追加のみ（既存の `Sync Status` 検証は通る） |
| `tm sync`（サブコマンドなし） | showHelp表示・exit 0不変 |
| `tm git` | syncStoreのrunGitCommand経由でPATH遅延化の影響を受けるが、実HOMEでは同一パスのため挙動不変 |
| データ形式 | `projects/<id>.json`・`config.json`・storeのschema変更なし。`src/types.ts` 変更なし |
| ヘルプ | 行追加のみで既存の記述は削除しない |

## 型安全規約への適合

- `as` キャスト・`any` 使用なし。`options.remote` は既存の `options.id` と同じ `typeof === 'string'` チェックで判別する
- `SyncDirState` はunion型リテラルで定義
- `spawnSync` の戻り値は既存どおり `result.status ?? 1` でnumber化（null伝播しない）
- テストコードのprocess.exitスタブは既存 `test/sync.test.ts` の記述を踏襲する

## 実装順序

1. syncStore.ts: パス遅延計算化（既存テストが全greenであることを確認）
2. syncStore.ts: 新関数9件（isSafeGitUrl / isValidSyncId 等の検証系を含む） + pullFromSyncメッセージ
3. test/sync.test.ts: HOME差し替えをファイル全体のbeforeEach/afterEachへ移設（既存テストが全green維持であることを確認してから次に進む）
4. test/sync.test.ts / test/index.test.ts: テスト追加（本設計の観点。実装より先に failing tests として書く）
5. commands/sync.ts: handleClone・applyAutoAdopt・各handler変更・showHelp
6. src/index.ts: getHelpText
7. docs/usage/index.md / docs/README.md: ドキュメント更新
