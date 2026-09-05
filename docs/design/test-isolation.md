# テスト隔離の共通基盤化 設計書

## 概要

テスト実行中に開発機の実データ（repo側DB: `<repo>/.git/task-memory.json` / `<repo>/.git/review-memory.json`、worktree等で `.git` が通常ファイルの場合は `<repo>/task-memory.json` / `<repo>/review-memory.json`、home側: `~/.local/task-memory` / `~/.task-memory.json` / `~/.review-memory.json`）へ到達しうる経路を、共通setupによるsandbox化で一本化して遮断する。個別テストファイルは隔離コードを書かなくなり、隔離の担保は `test/setup.ts`（sandbox構築）と `test/global-setup.ts`（実データ不変guard）の2点に集約される。`src/`（本番コード）は無変更。

## 前提条件

- **実行環境はLinux前提**。`os.homedir()` が `$HOME` 環境変数を参照するPOSIX仕様、`mkdtempSync` の一時ディレクトリ、`process.chdir` / fork process の挙動が前提（docs/design/sync-setup.md のsyncStore遅延パス設計と同じ前提）
- vitest 2.1.9・pnpm（`pnpm test` = `vitest run`）
- CI（`.github/workflows/check-pr-source.yml`）はPR作成元branchの検査のみでテストを実行しないため、本設計の影響はローカル実行のみ（詳細は「段階2未確定点の解決」）

## 背景・課題

### 実データへの到達経路（隔離が漏れた場合の事故経路）

| 経路 | 実装箇所 |
|---|---|
| `CODING_AGENT_ROOT` 優先の `.git` 解決 | `resolveGitPath()`（src/store.ts:47-54。src/reviewStore.ts も同一関数を利用） |
| sync repo `~/.local/task-memory` | `getSyncDir()`（src/syncStore.ts:11-13） |
| repo側DB（非globalモード） | `getDbPath()` / `getReviewDbPath()`（src/store.ts:56-73 / src/reviewStore.ts:7-24）。`.git` がディレクトリなら `<repo>/.git/task-memory.json` / `<repo>/.git/review-memory.json`、worktree等で `.git` が通常ファイルなら `<repo>/task-memory.json` / `<repo>/review-memory.json` |
| globalモードの `~/.task-memory.json` / `~/.review-memory.json` | src/store.ts:56-59 / src/reviewStore.ts:9 |
| save時の自動sync（`tryAutoSync`） | src/index.ts:21-23 の `setAfterSaveCallback` |

隔離なしでテストが `loadStore` / `saveStore` / `saveToSync` 等を呼ぶと、cwd・HOMEの解決結果しだいでこれらの実パスが直接読み書きされる。

### 現状の隔離実装の分散

- 14テストファイルが `test/helpers.ts` の `createTempProject()`（**実repo直下** `tmp/` 配下に `.git` 付きtempdirを作成）+ `process.chdir` で擬似projectを作る。実repoにネストするためgitの探索が親の実repoまで遡り、`GIT_CEILING_DIRECTORIES` 等の例外的な workaround が必要になる
- `test/sync.test.ts` のみが独自にHOME差し替え + `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 環境変数 + 隔離HOME用 `.gitconfig` を実装（33-64行）
- `test/global_mode.test.ts` は `process.cwd` のモック化と `/tmp/tm-*` 直下のfixtureで擬似化
- `test/git_search.test.ts` は `vi.mock('os')` で `homedir()` を `/tmp/fake-home` 静的パスに差し替え
- `test/commit.test.ts` 冒頭の `getCurrentCommit` は「cwdが実repoならhash・それ以外ならundefined」の両方を許容する非決定的なアサーションになっている
- `vitest.config.ts` はpluginsのみで、隔離に関する設定が無い

## 採用方針（段階2で確定済み・変更不可）

1. vitest.config.ts に `test: { environment: 'node', pool: 'forks', isolate: true, setupFiles: ['./test/setup.ts'] }` を明示
2. `test/setup.ts` 新設（隔離の唯一の担い）: CODING_AGENT_ROOT削除、sandbox=OS一時領域mkdtemp（配下に `home/` と `home/work/project/.git`）、HOME差し替え、`GIT_AUTHOR_*` / `GIT_COMMITTER_*` + sandbox `.gitconfig`、fail-hard assert、SIGTERM handler + exit handler でsandbox自己削除
3. globalSetup/teardownで実データ（repo側2点+home側3点の計5点。詳細は「監視対象」）の存在+内容ハッシュをrun前後比較、不一致でrun失敗（常設guard）
4. 個別ファイル整理: sync.test.ts のHOME/GITブロック削除、git_search.test.ts のos mock撤廃、global_mode.test.ts のsandbox前提化、commit.test.ts 冒頭の決定化、helpers.ts はsandbox配下生成のシナリオ構築として存続
5. test/README.md 更新（隔離はsetup.tsが唯一の担い、個別テストは隔離コードを書かない、前提崩しオプションの注意）
6. `src/`（本番コード）は無変更

## 全体像

```
pnpm test (vitest run)
│
├─ globalSetup: test/global-setup.ts（メインプロセス内の別global scope・実HOMEのまま）
│    監視対象5点のsnapshot（存在 + 内容ハッシュ）を取得
│    （TEST_ISOLATION_GUARD_PROBE_PATH指定時のみ: snapshot直後に当該pathへ1byte追記＝受入専用）
│
├─ テストファイルを実行するfork worker（pool: 'forks' + isolate: true
│   + fileParallelism: true + poolOptions.forks.singleFork: false）
│    └─ setupFiles: test/setup.ts
│         1. CODING_AGENT_ROOT + gitのsandbox外参照系env削除
│         2. sandbox = mkdtemp(OS一時領域)  → home/work/project/.git
│         3. HOME差し替え + git環境変数 + sandbox .gitconfig
│         4. process.chdir(sandbox project)
│         5. fail-hard assert（下記）
│         6. process.on('exit') 登録（worker終了時にsandbox自己削除）
│    └─ テスト本体（隔離コード不要。cwd/HOMEは最初からsandbox）
│    └─ afterAll（setup.tsが登録）: 隔離関連envの維持・非出現の再assert
│    └─ worker終了（tinypoolがSIGTERM送信）→ SIGTERM handler → sandbox削除
│         （exit handlerはSIGTERM未受信終了の最終防壁として残置）
│
└─ teardown（run正常完了時にのみ呼ばれる）: 監視対象5点を再snapshotして比較
     → 不一致ならrun失敗
```

`pool: 'forks'` が必須の理由: setup.tsが `process.env`（HOME・GIT_*）と `process.cwd` という**process全体の状態**を書き換えるため、同一process内でテストファイルを共有させる構成（threads pool等）では汚染が他ファイルへ漏れる。テストファイルを実行するworker（forkプロセス）+ isolate で、setup.tsが各ファイルの先頭で一から効くことを保証する。この「1worker=1テストファイル」相当の前提は、`isolate: true`・`poolOptions.forks.singleFork: false`・`fileParallelism: true` をconfigに明示することで固定する（vitest.config.ts節参照）。

## test/setup.ts（新設）

### sandbox構造

```
/tmp/tm-test-sandbox-XXXXXXXXXX/          # mkdtempSync(join(tmpdir(), 'tm-test-sandbox-'))
└── home/                                  # HOME差し替え先（os.homedir() == ここ）
    ├── .gitconfig                         # 後述の内容
    └── work/
        └── project/
            └── .git/                      # 空ディレクトリ（実repoではない擬似repo）
```

- `home/work/project` がテストファイル開始時のcwd。以降 `resolveGitPath()` は `home/work/project/.git` を返し、findGitPathの遡上は `home` で停止する。テストファイルのmodule load時点（例: sync.test.ts のmodule level `TMP_ROOT`）からこのcwdが効く
- `.git` は空ディレクトリ（`createTempProject()` と同じ作り）。gitは実repoとして扱わないため `getCurrentCommit()` 等は決定的に失敗する（commit.test.ts 決定化の前提）

### 擬似コード

```typescript
// test/setup.ts
import { join, sep } from 'path';
import { homedir, tmpdir } from 'os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { afterAll } from 'vitest';
import { resolveGitPath } from '../src/store';

const sandbox = mkdtempSync(join(tmpdir(), 'tm-test-sandbox-'));
const home = join(sandbox, 'home');
const work = join(home, 'work');
const project = join(work, 'project');

// 隔離のために「設定する」環境変数（afterAll・worker終了時に維持を検証する）
const KEEP_ENV: Readonly<Record<string, string>> = {
    HOME: home,                                            // os.homedir() / getSyncDir() / globalモードDBの隔離
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),           // 実~/.gitconfig・XDG実configを読ませない
    GIT_CONFIG_NOSYSTEM: '1',                              // /etc/gitconfig（gpgsign等）も読ませない
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
};
// 隔離のために「削除する」環境変数（親環境に設定があると子プロセスgitがsandbox外を参照・更新しうる）
const UNSET_ENV_KEYS = [
    'CODING_AGENT_ROOT',
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_TEMPLATE_DIR',
] as const;
const UNSET_ENV_PATTERN = /^GIT_CONFIG_(KEY|VALUE)_\d+$/;   // GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n

function isolationEnvProblem(): string | null {
    for (const [key, value] of Object.entries(KEEP_ENV)) {
        if (process.env[key] !== value) return `${key} must be ${value}, got ${process.env[key]}`;
    }
    for (const key of UNSET_ENV_KEYS) {
        if (process.env[key] !== undefined) return `${key} must be unset`;
    }
    for (const key of Object.keys(process.env)) {
        if (UNSET_ENV_PATTERN.test(key)) return `${key} must be unset`;
    }
    return null;   // 問題なし
}

// sandbox作成直後に終了処理を登録する（以降のassert失敗でthrowしてもsandboxは必ず削除される）。
// このhandler群が発火するのはworker（forkプロセス）の終了時であり、テストファイルの完了時点では無い。
// vitest 2.1.9のforks pool（tinypool 1.1.1）はworkerの終了をSIGTERMで行うため、通常runでの
// 削除の主体はSIGTERM handler（SIGTERM終了ではNodeのexitイベントは発火しない）
process.on('SIGTERM', () => {
    // cleanup内の例外に関わらず終了は保証する（finallyでexitへ到達）
    try {
        rmSync(sandbox, { recursive: true, force: true });
    } finally {
        process.exit(143);   // SIGTERM受信時のdefault終了相当
    }
});
// exit handlerはSIGKILL等でSIGTERMが届かなかった終了経路の最終防壁
process.on('exit', () => {
    const leaked = isolationEnvProblem();
    rmSync(sandbox, { recursive: true, force: true });
    if (leaked !== null) {
        // テスト結果への反映はafterAll（下記）が主。ここはworker終了時の最終防壁
        //（exit codeを汚して異常を可視化する）
        console.error(`[test-isolation] isolation env leaked: ${leaked}`);
        process.exitCode = 1;
    }
});

mkdirSync(join(project, '.git'), { recursive: true });

// --- 環境差し替え（ここが隔離の唯一の担い。個別テストは書かない） ---
for (const key of UNSET_ENV_KEYS) delete process.env[key];
for (const key of Object.keys(process.env)) {
    if (UNSET_ENV_PATTERN.test(key)) delete process.env[key];
}
for (const [key, value] of Object.entries(KEEP_ENV)) process.env[key] = value;
writeFileSync(join(home, '.gitconfig'),
    '[user]\n\tname = test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n', 'utf-8');

process.chdir(project);

// --- fail-hard assert（1つでも違えばthrowしてこのテストファイルを即失敗させる） ---
function assertIsolation(): void {
    const envProblem = isolationEnvProblem();
    if (envProblem !== null) throw new Error(`[test-isolation] ${envProblem}`);
    if (homedir() !== home) throw new Error(`[test-isolation] homedir() must be ${home}, got ${homedir()}`);
    if (process.cwd() !== project) throw new Error(`[test-isolation] cwd must be ${project}, got ${process.cwd()}`);
    const gitPath = resolveGitPath();
    if (gitPath === null || !gitPath.startsWith(sandbox + sep)) {
        throw new Error(`[test-isolation] resolveGitPath() must stay under sandbox, got ${gitPath}`);
    }
}
assertIsolation();

// テスト実行後の検証（setup file内のafterAllは全テストファイルに適用される）。
// cwdはテストが合法的にchdirして終わる余地があるため対象外。envは
// 「設定した隔離変数（KEEP_ENV）の維持」と「削除を維持すべき変数（UNSET_ENV_KEYS・
// UNSET_ENV_PATTERN）の非出現」の両方を検証する。テストが一時的に差し替えて
// afterEachで戻す分には問題なく、恒久的な変更だけが失敗になる
afterAll(() => {
    const envProblem = isolationEnvProblem();
    if (envProblem !== null) {
        throw new Error(`[test-isolation] env isolation broken after tests: ${envProblem}`);
    }
});
```

### 各設定の理由

| 設定 | 理由 |
|---|---|
| `delete process.env.CODING_AGENT_ROOT` | `resolveGitPath()` がCODING_AGENT_ROOTを最優先するため、開発機の実運用でこの変数が立っているとfork内でも実repo `.git` 直結になる。fork起動時に必ず削除する |
| `HOME` 差し替え | `os.homedir()` 経由の全経路（`getSyncDir()` = `~/.local/task-memory`、globalモードの `~/.task-memory.json` / `~/.review-memory.json`）をsandbox配下へ向け替える |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` + `.gitconfig` の `[user]` | sandbox HOMEには実 `~/.gitconfig` が無いため、`git commit`（handlePush等、src内部のcommitも含む）がidentity不明で失敗しないようにする。env変数と `[user]` の二重化は、`git commit`（envで効く）と将来のgitサブコマンド追加（config参照で効く）の両方に耐えるため |
| `.gitconfig` の `[init] defaultBranch = main` | `git init` のデフォルトbranchがgit/OS設定に依存して不定（master/main）にならないようにする。sync.test.ts のbare remote群はすべて `main` 前提 |
| `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_NOSYSTEM` | HOME差し替えだけだと、ユーザー環境の `XDG_CONFIG_HOME` や `/etc/gitconfig`（例: `commit.gpgsign = true`）がfork内のgitへ漏れ、テストが環境依存で壊れる。sandbox `.gitconfig` を唯一のglobal config、system configを無効にして決定化する |
| `GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` / `GIT_INDEX_FILE` / `GIT_OBJECT_DIRECTORY` / `GIT_ALTERNATE_OBJECT_DIRECTORIES` / `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS`（+ `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`）の削除 | 開発shellの親環境にこれらが設定されていると、子プロセスのgitがsandbox外のrepo・worktree・index・object領域・追加config（`-c` 相当の設定注入を含む）を直接参照・更新しうる（HOME差し替えでは防げない別経路）。fork起動時に全て削除する |
| `GIT_TEMPLATE_DIR` の削除 | 親環境でtemplate directory（実行可能hookを含む）が指定されていると、テスト内の `git init`（commit.test.ts・sync.test.ts等）がそのtemplateをsandbox repoへコピーし、以降のcommitでhookが実行されうる（テスト失敗・sandbox外への書き込み）。fork起動時に削除し、git標準のinstall prefix既定templateに固定する |

### fail-hard assertの失敗時挙動

- setup file内での `throw` はvitest標準の挙動に従い、**そのテストファイルを即座に失敗**させる（以降のテストは実行されない）。エラーメッセージは `[test-isolation]` prefixで何が違っていたかを1行で示す
- env assertは「設定した隔離変数（KEEP_ENV）の維持」と「削除を維持すべき変数（UNSET_ENV_KEYS・ `GIT_CONFIG_(KEY|VALUE)_n`）の非出現」の2系統を検証する
- 他テストファイル・run全体の中断はしない（vitestのsetup fileのsemantics）。run全体を落とすのは `test/global-setup.ts` のguard（実データ変更を検知したらrun失敗）との二段構え

### 終了処理

- sandbox削除の主体は `process.on('SIGTERM', ...)`（rmSyncをtry/finallyで実行し、finallyで `process.exit(143)` に到達させる）。**vitest 2.1.9のforks pool（tinypool 1.1.1）はworkerの終了を `process.kill()`（=SIGTERM、5秒後にSIGKILL）で行い、SIGTERM終了ではNodeの `'exit'` イベントは発火しない**ため、`process.on('exit')` だけでは正常runでもsandboxが削除されない（実測: 18テストファイル分18個のsandboxが残留）。SIGTERM handlerが通常run終了時の削除を担い、`process.on('exit')` はSIGTERMが届かない終了経路の最終防壁として残置する
- **HOME・GIT_*等の環境変数は復元しない**（復元処理が抜けるとその後の処理が実HOMEへ書きうる。workerはファイル終了後に破棄されるため復元は不要で、復元しないことが安全側になる）
- **sandbox削除が走るのはworker（forkプロセス）の終了時であり、テストファイルの完了時点ではない**。`isolate: true`・`singleFork: false`・`fileParallelism: true` を満たす限りworkerはテストファイルごとに起動・終了するため実質ファイル完了時と一致するが、保証の主体はあくまでworker終了である
- この前提をCLI上書き（`--singleFork`・`--no-file-parallelism`・`--no-isolate`・pool変更等）で崩し、1workerが複数テストファイルを続けて実行する構成になった場合も、setup.tsはファイルごとに実行され、SIGTERM handler・exit handlerはsetupごとに累積登録されてworker終了時に全sandboxが削除される。**ファイルごとのsandboxがrun終了まで `/tmp` に残ることを許容する設計**とする（残骸は実データに影響せず無害。通常runでは発生しない）
- SIGKILL等の異常終了ではSIGTERM・exitのどちらのhandlerも走らず `/tmp` にsandbox残骸が残りうる。実データへの影響は無く無害。`ls -d /tmp/tm-test-sandbox-*` で確認できたものは手動削除してよい。異常終了時の実データ確認手段はguardの「既知の限界」を参照

## test/global-setup.ts（新設・実データguard）

### 形式

vitestの `globalSetup` を使う。default exportのsetup関数がrun前に一度だけ、**vitestメインプロセス内の別global scope**（テストファイルを実行するfork workerとは別の実行コンテキスト。setup.tsによる環境差し替えの影響を受けないため、`homedir()` は実HOMEのまま動く）で実行され、戻り値としてteardown関数を返すとrun後に一度だけ呼ばれる。teardownでのthrowはvitestのunhandled errorとして**runをexit code 1で失敗**させる。

**teardownが呼ばれるのはrunの正常完了時のみ**。SIGKILL・異常終了では呼ばれないため、その場合guardは機能しない（確認手段は「既知の限界」参照）。

repo rootは `globalSetup` 実行時のcwdに依存せず、ファイル位置から決める:

```typescript
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));  // test/ の親
```

### 監視対象5点

home側3点は固定、repo側2点は `<repo>/.git` の実体で分岐する（worktree等で `.git` が通常ファイルの場合、DBは `.git` 配下ではなくrepo root直下に作られるため、`.git/task-memory.json` 固定の監視では検知漏れになる）。

| 分類 | label | path |
|---|---|---|
| home側（固定） | sync repo | `~/.local/task-memory` |
| home側（固定） | global task DB | `~/.task-memory.json` |
| home側（固定） | review memory | `~/.review-memory.json` |
| repo側（`.git` がディレクトリ） | repo task DB / repo review DB | `<REPO_ROOT>/.git/task-memory.json` / `<REPO_ROOT>/.git/review-memory.json` |
| repo側（`.git` が通常ファイル=worktree等） | repo task DB / repo review DB | `<REPO_ROOT>/task-memory.json` / `<REPO_ROOT>/review-memory.json` |

repo側の分岐は本番コードの解決と同じ挙動にする（`getDbPath()` / `getReviewDbPath()` は `statSync(gitPath).isDirectory()` でfollowして判定するため、分岐判定もfollow前提。監視対象のpath自体のハッシュ計算は後述のlstat原則に従う）:

```typescript
const gitPath = join(REPO_ROOT, '.git');
const repoDbDir = statSync(gitPath).isDirectory() ? gitPath : REPO_ROOT;
// 監視対象: join(repoDbDir, 'task-memory.json'), join(repoDbDir, 'review-memory.json')
```

`~` は `homedir()`（globalSetupの実行コンテキストでは実HOME）。**存在しないことも状態の一部**とする（absent → present も不一致）。

### ハッシュ定義

監視対象pathを「相対パス（`/` 区切り）・種別・mode・内容」の行集合に直し、行を相対パス辞書順にソート・連結した全体の `sha256` をhashとする（行数をentries数として報告に使う）。監視対象自身がfileでもdirectoryでもこの行形式で統一する。

- **file**: `<rel>\0file\0<mode>\0<sha256hex(内容)>` の1行（対象自身のchmodも変更として検出する）
- **directory**（`~/.local/task-memory` はgit repoであるため、構成+内容全体の再帰ハッシュ）:
  1. 対象ディレクトリ配下を再帰走査し、各エントリを行に直す。集計root自体のmodeもrelPathが空の行（`\0dir\0<mode>`）として含める（対象自身のchmod検知）
     - file: `<rel>\0file\0<mode>\0<sha256hex(内容)>`
     - directory: `<rel>\0dir\0<mode>` （内容は配下の行で表現）
     - その他（fifo等）: `<rel>\0special\0<mode>`
     - `<mode>` は `lstatSync(entry).mode` を8進文字列化したもの（permission bitsを含む。chmodによる改変も「変更」として検出する）
- **symlink（監視対象自身・配下entryの両方）**: `<rel>\0symlink\0<mode>\0<readlinkのターゲット文字列>` 行に加えて、**参照実体を `${rel}/` prefix（top-levelはrel=''のまま）配下の行として再帰的に辿る**。理由: 本番コードの書き込み（`writeFileSync` 等のNode fs API・子プロセスgit）はsymlinkを辿って参照実体へ届くため、リンクテキストのみでは実体の変更を検知できず隔離失敗が漏れる（参照実体のfile行・directory走査は通常の行形式と同一）
  - 参照実体が解決できない（broken link・loop）場合は `${rel}/\0absent` 行として固定し、run中にlink越しに実体が作られれば不一致として検知する
  - 参照実体がfifo等のspecialの場合は内容を読まない（読み取りがblockしうるため。種別+modeのみ）
- **走査の原則（同一実体の再訪防止）**: 種別判定は `readdirSync(dir, { withFileTypes: true })` の `Dirent`（linkを辿らない）で行い、mode取得は `lstatSync`（参照実体の判定・modeは `statSync`）。directory実体は `dev:ino` でvisited管理し、同一実体の再訪（symlink loop・複数linkからの同一dir参照）は `dir-cycle` marker行で打ち切って無限再帰を防ぐ。子の走査は**名前順**に行い、marker行の現れ方を決定化する（visitedの状態に行内容が依存するため、最終sortだけでは決定化できない）
- **mtimeは含めない**（読み取りやtouchによる偽陽性を避ける。内容・構成・permissionで「テストが書いたか」を判定する）
- **保護範囲外**: 所有者（uid/gid）・ACL・xattrはハッシュに入れない。理由: 本guardの目的はtmのデータ経路による実データ破壊の検知であり、tmが書きうるのは内容・構成・permissionの範囲に収まるため。uid/ACL/xattr単独の変更を検知できないことは限界として受容する（「既知の限界」参照）
- **absent**: hashを計算せず `absent` を記録

### 擬似コード

```typescript
// test/global-setup.ts
import { appendFileSync } from 'fs';   // 他import省略

export default function globalSetup(): () => Promise<void> {
    const before = new Map(TARGETS.map((t) => [t.path, snapshotPath(t.path)]));

    // 受入専用プローブ（通常runでは未指定・何もしない）。
    // 「run中に実データが壊された」状況を安全に再現するため、before snapshot取得直後
    // （=beforeには健全な内容が記録済み）に指定pathへ1byte追記する。
    // runの前に手動で破壊するとglobalSetupが破壊後の内容をbeforeとして記録し、
    // guardが発火しなくなるため、破壊は必ずこのフック（snapshot直後・teardown前）経由とする。
    // 誤指定で監視対象外の実ファイルを破壊しないよう、追記前に指定pathが監視対象5点の
    // いずれかと完全一致し、かつsnapshotがpresentであることを検証する
    // （不一致・absentなら追記前にthrowしてrunを落とす）
    const probe = process.env.TEST_ISOLATION_GUARD_PROBE_PATH;
    if (probe !== undefined) {
        const probeTarget = targets.find((t) => t.path === probe);
        const probeSnap = probeTarget !== undefined ? before.get(probeTarget.path) : undefined;
        if (probeTarget === undefined || probeSnap === undefined || probeSnap.state !== 'present') {
            throw new Error(`[test-isolation-guard] PROBE: path is not a present guarded target: ${probe}`);
        }
        appendFileSync(probe, 'x');
        console.error(`[test-isolation-guard] PROBE: appended 1 byte to ${probe} after snapshot (acceptance only)`);
    }

    return async () => {
        const problems: string[] = [];
        for (const t of TARGETS) {
            const beforeSnap = before.get(t.path);
            const after = snapshotPath(t.path);
            if (JSON.stringify(after) !== JSON.stringify(beforeSnap)) {
                problems.push(formatProblem(t, beforeSnap, after));
            }
        }
        if (problems.length > 0) {
            console.error('[test-isolation-guard] 実データがテスト実行中に変更されました:');
            for (const p of problems) console.error(p);
            console.error('復旧: ./tmp/ のバックアップ（受入手順(a)）から復元してください。');
            throw new Error(`isolation guard failed: ${problems.length} path(s) changed`);
        }
        console.log('[test-isolation-guard] all guarded targets unchanged');
    };
}
```

`TEST_ISOLATION_GUARD_PROBE_PATH` は**受入手順(d)専用**のフックで、指定すると監視対象の実データに1byte追記する（=意図的な破壊）。backup（受入手順(a)）を取った上で、必ず存在する監視対象1点を指定する。通常runで絶対に設定しないこと。追記前に指定pathが監視対象5点のいずれかと完全一致することとsnapshotがpresentであることを検証し、不一致・absentならrunを落として追記しない（誤指定で監視対象外の実ファイルを破壊する事故の防止）。

### 不一致時の報告形式

teardownがstderrへ出力する例:

```
[test-isolation-guard] 実データがテスト実行中に変更されました:
  1. /home/<user>/.local/task-memory (sync repo)
     before: a1b2c3d4e5f6...(1234 entries)
     after:  9f8e7d6c5b4a...(1239 entries)
  2. /home/<user>/.task-memory.json (global task DB)
     before: absent
     after:  present (sha256 0f1e2d...)
復旧: ./tmp/ のバックアップ（受入手順(a)）から復元してください。
```

runはexit code 1で失敗する。成功時は `all guarded targets unchanged` の1行のみを出力する（受入手順でguardが効いたことを確認できるように）。

### 既知の限界

- **偽陽性**: テスト実行中に利用者が並行して `tm` コマンドを使うと実データは正当に変化し、guardが発火する。その場合は報告された差分が自分の操作と一致するか確認し、問題なければ再実行で確認する
- **偽陰性**: mtimeのみの変化・同一内容+同一permissionでの削除再作成、および所有者（uid/gid）・ACL・xattr単独の変更は検出しない（内容・構成・permission不変ならtmのデータ経路として実害が無いため、意図的に保護範囲外とする。ハッシュ定義参照）
- **異常終了でguard自体が動かない**: teardownはrunの正常完了時にのみ呼ばれるため、SIGKILL・異常終了では検証が行われない。その場合の確認手段は (1) 次回runのsnapshot比較（ただし次回のbeforeに壊れた状態が記録され、その後さらに変更が起きなければ発火しない点に注意）か、(2) 手動backupとの比較（受入手順(a)(c)と同じ手順）。受入手順(a)のbackupは異常終了時の復旧資材を兼ねる
- `~/.local/task-memory` 配下に巨大なpackfile等があるとhash計算に時間がかかるが、task-memoryのsync repoは小さい前提で全体hashとする

## vitest.config.ts 変更後の全体像

```typescript
export default defineConfig({
    plugins: [rawMdPlugin()],   // 既存のまま
    test: {
        environment: 'node',
        pool: 'forks',
        isolate: true,
        fileParallelism: true,                          // 前提の明示（defaultと同一）
        poolOptions: { forks: { singleFork: false } },  // 前提の明示（defaultと同一）
        setupFiles: ['./test/setup.ts'],
        globalSetup: ['./test/global-setup.ts'],
    },
});
```

- `environment` / `isolate` は現状defaultと同一だが、本設計の前提であることを明示する（方針1）
- `fileParallelism: true` / `poolOptions.forks.singleFork: false` もdefaultと同一だが、「1setup起動=1テストファイルに相当するworker分離」という前提をCLIフラグ等の偶然の上書きで崩されないよう明示する。これらを上書きする実行（`--singleFork`、`--no-file-parallelism`、`--no-isolate`、`--pool` 変更等）はサポート外（test/README.mdにも記載）。上書きされた場合も実データguard（globalSetup/teardown）は継続して動作するが、ファイル単位のsandbox寿命・env分離の前提は崩れ、sandboxはrun終了時まで `/tmp` に残る（終了処理節の許容設計）
- `setupFiles` のみ先に有効化し、`globalSetup` は実装順序の最終段で追加する（実装順序参照）

## test/helpers.ts 新仕様

「sandbox配下生成のシナリオ構築」として存続。**`TMP_ROOT`（実repo直下 `tmp/`）は廃止**し、生成先をsandbox HOME配下へ変える。実repo配下にテストが書くことが完全になくなる。

```typescript
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

// sandboxのwork領域（setup.tsが home/work/project を作成済みであるため必ず実在する）
export function getSandboxWorkDir(): string {
    return join(homedir(), 'work');
}

export function createTempProject(): string {
    const dir = join(getSandboxWorkDir(), `test-${Date.now()}-${randomUUID().slice(0, 10)}`);
    mkdirSync(join(dir, '.git'), { recursive: true });
    return dir;
}

export function removeTempDir(dir: string): void {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
```

- `createTempProject()` のシグネチャ・戻り値・`.git` 空ディレクトリを作る挙動は不変（呼び出し側14ファイルはパス変更のみで追従）
- 実repoネストが消えるため、gitの探索が親の実repoへ遡る構造自体がなくなる
- `getSandboxWorkDir()` を追加する理由: sync.test.ts のbare remote等、`.test.ts` 側で直接一時領域を作る箇所の生成先としても使う（次節）

## 個別ファイルの変更

### test/sync.test.ts

1. **HOME/GITブロック削除**（現33-64行）: `originalHome` / `homeDir` / `originalGitEnv` / `GIT_IDENTITY_ENV` 宣言と、HOME差し替え + `.gitconfig` 生成 + GIT_* env設定の `beforeEach` / `afterEach` を削除する。旧ブロックは2つの機能を持っており、集約先を分けて扱う:
   - **HOME差し替え（環境隔離）**: setup.tsへ集約される。「個別テストは隔離コードを書かない」原則は変わらず、環境隔離の担いはsetup.tsのみ
   - **テストごとのsync領域リセット（シナリオ状態構築）**: 旧 `afterEach` の `rmSync(homeDir)` が `~/.local/task-memory`（getSyncDir）をテストごとに空に戻していた。これは隔離ではなく「各テストが未同期状態から始まる」というシナリオ前提の構築であるためsetup.tsへは集約せず、トップレベル `afterEach` に `rmSync(join(homedir(), '.local', 'task-memory'), { recursive: true, force: true })` のみを残置してリセット機能を存続させる（`homedir()` はこの時点でsandbox HOMEを返すため掃除対象はsandbox配下に限られる。それ以外は掃除しない）
   `mkdtempSync` / `writeFileSync` importは他の使用箇所（`createBareRemote` / `seedRemote` / テスト本体）が残るため維持
2. **module level `TMP_ROOT` の差し替え**（現24-27行）: `const TMP_ROOT = join(process.cwd(), 'tmp')` を `const TMP_ROOT = getSandboxWorkDir()` へ変更し、helpersから `getSandboxWorkDir` を追加importする。これにより:
   - 「chdir前のcwdを固定する」旨の旧コメント（24-26行）は不要になるので、`getSandboxWorkDir()` の参照説明に書き換える
   - `createBareRemote` / `seedRemote` / `pushBranchFrom` の `mkdtempSync(join(TMP_ROOT, ...))` は**変更不要**（`home/work` はsetup.tsが作成済みで実在するため、旧HOMEブロックの `mkdirSync(TMP_ROOT)` 相当が不要になる）
3. **`GIT_CEILING_DIRECTORIES` のテスト（現512-534行、`sync-add.auto-generated-id-invalid`）はシナリオとして残す**: `spaceDir` の生成先が `join(originalCwd, 'tmp', ...)` で、`originalCwd` はsandbox projectになるため、自動的にsandbox配下へ移る（コード変更不要）。ceiling設定は実repoを探索させない意図の明示として残置する

### test/git_search.test.ts

- `vi.mock('os', ...)` を撤廃。`homedir()` はsandbox homeを返すため、fixtureを実ディレクトリで作る:

```typescript
const root = join(homedir(), 'work', `git-search-${Date.now()}`);
const project = join(root, 'project');
const subdir = join(project, 'subdir');
// beforeAll: mkdirSyncで project/.git と subdir を作成（sandbox配下のため権限問題なし）
// afterAll: 何もしない（sandboxがrun終了時に自己削除する。旧コメントも削除）
```

- 4テストの期待値は不変（`findGitPath` の開始dirとhome境界の関係が同じ形で再現されるだけ）。「home直下の `.git` を見つける」テストが `home/.git` を作って `rmdirSync` する挙動もそのまま（sandbox home配下でのみ効く）

### test/global_mode.test.ts

sandbox前提化。`process.cwd` モック方式自体は維持（非git cwdの擬似として本番の解決経路に忠実）。

- `/tmp` 直下リテラル（現54・93・114・129・142-143・163行）をすべて `join(homedir(), 'work', ...)` へ変更（sandbox配下へ。`useNonGitCwd()` の `join(homedir(), '.tm-test-nongit-...')` は既にsandbox配下なのでコード不変・コメントのみ更新）
- 各テスト末尾の `try { rmSync(...) } catch {}` クリーンアップはsandbox自己削除で不要になるため削除
- `afterEach` の `process.env = { ...origEnv }` は維持（`origEnv` はmodule load時=setup適用後に取得されるため、復元してもHOME=sandbox・CODING_AGENT_ROOT無しの状態に戻る。setup.tsのafterAll/exit検知と矛盾しない）
- 冒頭の `homeIsGitRepo` skipIfガードは維持（sandbox homeでは通常false）

### test/commit.test.ts

冒頭 `describe('getCurrentCommit')` を決定化する:

```typescript
describe('getCurrentCommit', () => {
    it('should return undefined outside a real git repository', () => {
        // setup.tsがcwdとするsandbox projectの.gitは空ディレクトリ（実repoではない）。
        // git rev-parseは失敗し、決定的にundefinedを返す
        expect(getCurrentCommit()).toBeUndefined();
    });
});
```

- 旧実装は「cwdが実repoならhash・それ以外ならundefined」の両方を許容していた（cwdが実repoにあることに暗黙依存）。sandbox化により常にundefinedに決定する
- 2番目以降のdescribe（実git repoを作るテスト）は不変。`git config user.email/user.name` をrepo内に設定しているためsandbox環境でもそのまま動く

### 変更しないテストファイル

`block / close / dispatch / docs / finish / get / index / list / new / orderUtils / review / statusGuard / store` の各テストは、`createTempProject()` の生成先変更のみで追従し、テストコード自体の変更は不要（chdir先がsandbox配下に変わるだけで期待値は不変）。

## test/design/sync-setup.toml・verify-conditions.py への影響

確認結果: **テストの削除・リネームは発生しない**。sync.test.ts から削除するのはHOME/GITブロック（beforeEach/afterEachのみ。`[covers:*]` タグを持つテストケースは1件も削除しない）のため、dangling tag・網羅検査への影響はない。

対応が必要なのは `source_lines` の自動同期のみ:

- sync.test.ts の行削除により全 `[covers:*]` テストの行番号がずれる
- `python3 scripts/design/verify-conditions.py` が検査(d)で `[covers:]` タグ走査結果へ `source_lines` を自動同期してtomlへ書き戻すため、**実装完了後に1回実行すればよい**（実装順序に組み込み済み）
- `meta.source_hash`（src/syncStore.ts のhash）はsrc無変更のため不変
- `git_search / global_mode / commit` の各テストはtest-structure管理対象外（適用範囲はsync-setup機能のみ）のためtoml影響なし
- 本設計の隔離基盤（setup.ts / global-setup.ts）は機能の入出力分岐ではないため `test/design/` への新規条件書は作成しない。将来test-structure管理へ移行する場合は別タスクとする

## test/README.md の更新

以下を追記・更新する:

1. 新規節「テスト隔離（test/setup.ts）」:
   - 隔離の唯一の担いは `test/setup.ts`（HOME差し替え・CODING_AGENT_ROOT/git参照系env削除・GIT_*・sandbox cwd）。**個別テストは隔離コード（HOME差し替え・env操作・os mock）を書かない**
   - sandbox構造の説明（本設計書への参照）
   - 実データguard（`test/global-setup.ts`）がrun前後で監視対象5点（repo側2点+home側3点）の不変を検証すること
   - **前提崩しオプションの注意**: `--no-isolate`、`--pool=threads`、`--singleFork`、`--no-file-parallelism` 等のfork/isolate前提を崩すCLI上書きはsandboxの前提（テストファイルごとの独立workerでenv・cwdが初期化されること）を壊すためサポート外。config側で明示済みの値（`isolate: true`・`fileParallelism: true`・`singleFork: false`）をCLIで上書きして実行しない
2. ファイル一覧テーブルに `setup.ts`（テスト隔離基盤・sandbox構築）と `global-setup.ts`（実データ不変guard）の行を追加
3. `helpers.ts` の説明として「sandbox配下生成のシナリオ構築（createTempProject / getSandboxWorkDir / removeTempDir）」を追記

## 段階2未確定点の解決

### (i) src/test内の spawnSync / execSync で env を明示渡している箇所

grep結果: **該当なし**。src/ の `spawnSync` 7箇所（src/store.ts:222、src/syncStore.ts:48/114/205/215/326/338）と test/ の `spawnSync` / `execSync`（test/sync.test.ts、test/commit.test.ts）はすべて `env` option未指定 = `process.env` を継承する。したがってsetup.tsのHOME・GIT_*差し替えは子プロセスのgitへそのまま伝播し、**追加の対処は不要**（逆に言えば、envを明示渡す実装が将来追加された場合はfork内のenv（sandbox済み）を渡す限り隔離は保たれる）。

### (ii) CI設定の有無とHOME仕様への影響

`.github/workflows/` 配下は `check-pr-source.yml` のみ（PR作成元branchがdevかを検査するjob。**テストを実行しない**）。CIでテストが走らないため、sandbox HOME仕様がCIへ与える影響はない。テスト実行はローカルLinuxのみで、「実行環境Linux前提」の前提条件と整合する。

## 受入手順（事故条件再現検証）

破壊が起きても復旧可能な順（backup → 事故条件 → 不変検証 → 感度証明）で行う。backup先は集約ルールに従い `./tmp/` 配下とする。

### (a) 監視対象を `./tmp/` へbackup（present/absent marker付き）

監視対象が**存在しない環境では `cp` も `diff` も失敗して手順が成立しない**ため、各対象について「コピー + `.present` marker」または「`.absent` markerのみ」を保存する:

```bash
BK=./tmp/20260905_backup_isolation-acceptance_test-isolation
mkdir -p "$BK"

# home側3点
if [ -e ~/.local/task-memory ]; then cp -a ~/.local/task-memory "$BK/task-memory"; touch "$BK/task-memory.present"; else touch "$BK/task-memory.absent"; fi
if [ -e ~/.task-memory.json ]; then cp -p ~/.task-memory.json "$BK/home-task-memory.json"; touch "$BK/task-memory.json.present"; else touch "$BK/task-memory.json.absent"; fi
if [ -e ~/.review-memory.json ]; then cp -p ~/.review-memory.json "$BK/home-review-memory.json"; touch "$BK/review-memory.json.present"; else touch "$BK/review-memory.json.absent"; fi

# repo側2点（.gitがディレクトリである通常の開発機での例。worktreeで.gitが通常ファイルの場合は
# .git/task-memory.json → task-memory.json、.git/review-memory.json → review-memory.json に読み替える）
if [ -e .git/task-memory.json ]; then cp -p .git/task-memory.json "$BK/repo-task-memory.json"; touch "$BK/repo-task-memory.present"; else touch "$BK/repo-task-memory.absent"; fi
if [ -e .git/review-memory.json ]; then cp -p .git/review-memory.json "$BK/repo-review-memory.json"; touch "$BK/repo-review-memory.present"; else touch "$BK/repo-review-memory.absent"; fi
```

guardは absent を正当な状態として記録するため、対象が無い環境でも(a)はmarkerの作成だけで成立する。

### (b) 事故条件を与えて `pnpm test`

`CODING_AGENT_ROOT` を実repoへ向けてテストを実行する（隔離が無ければ `resolveGitPath()` が実repo `.git` を返し、テストが実repoの `.git/task-memory.json` を書く事故条件）:

```bash
CODING_AGENT_ROOT="$(pwd)" pnpm test
```

期待結果:

- 全テストpass（setup.tsがCODING_AGENT_ROOTをworker内で削除するため事故条件は遮断される）
- teardown guardがpass（`[test-isolation-guard] all guarded targets unchanged` が出力される）
- exit code 0

### (c) teardown不変検証 + 手動diff確認（markerで分岐）

backupのmarkerに従い、present対象は内容比較、absent対象は「作成されていないこと」の確認を行う:

```bash
BK=./tmp/20260905_backup_isolation-acceptance_test-isolation

if [ -f "$BK/task-memory.present" ]; then
    diff -r ~/.local/task-memory "$BK/task-memory"
else
    [ ! -e ~/.local/task-memory ] || echo 'CREATED: ~/.local/task-memory'
fi
if [ -f "$BK/task-memory.json.present" ]; then
    cmp ~/.task-memory.json "$BK/home-task-memory.json"
else
    [ ! -e ~/.task-memory.json ] || echo 'CREATED: ~/.task-memory.json'
fi
if [ -f "$BK/review-memory.json.present" ]; then
    cmp ~/.review-memory.json "$BK/home-review-memory.json"
else
    [ ! -e ~/.review-memory.json ] || echo 'CREATED: ~/.review-memory.json'
fi
if [ -f "$BK/repo-task-memory.present" ]; then
    cmp .git/task-memory.json "$BK/repo-task-memory.json"
else
    [ ! -e .git/task-memory.json ] || echo 'CREATED: .git/task-memory.json'
fi
if [ -f "$BK/repo-review-memory.present" ]; then
    cmp .git/review-memory.json "$BK/repo-review-memory.json"
else
    [ ! -e .git/review-memory.json ] || echo 'CREATED: .git/review-memory.json'
fi
```

- 全出力なし（`diff -r` 無出力・`cmp` 沈黙・CREATED行なし）で合格
- `CREATED:` 行が出た場合（backup時absentだった対象へテストが書き込んだ場合）は、内容を確認のうえ**作成物を明示削除して元のabsentへ戻す**（例: `rm ~/.task-memory.json`）。present対象に差分が出た場合はbackupから復元する（例: `cp -p "$BK/home-task-memory.json" ~/.task-memory.json`）
- 加えてsandbox残骸が無いことも確認する（SIGTERM handlerによりworker終了時にsandboxは自己削除されるため、正常runでは出力なしになる。出力がある場合はSIGKILL等の異常終了の残骸）:

```bash
ls -d /tmp/tm-test-sandbox-* 2>/dev/null   # 出力なしであること
```

### (d) guardの感度証明（guardが実際にfailすることの確認）

**runの前に手動で破壊してはならない**（globalSetupが破壊後の内容をbefore snapshotとして記録し、guardが発火しなくなるため）。破壊は受入専用フック `TEST_ISOLATION_GUARD_PROBE_PATH`（globalSetupがsnapshot取得直後に指定pathへ1byte追記する）で行う。対象は必ず(a)でbackup済みの存在する監視対象1点を選ぶ:

```bash
BK=./tmp/20260905_backup_isolation-acceptance_test-isolation
TEST_ISOLATION_GUARD_PROBE_PATH="$HOME/.task-memory.json" pnpm test -- test/orderUtils.test.ts
# 期待: run失敗（exit code 1）・stderrにPROBE行と ~/.task-memory.json の hash mismatch 報告

# backupから復元し、再実行でpassすることを確認
cp -p "$BK/home-task-memory.json" ~/.task-memory.json
pnpm test -- test/orderUtils.test.ts
# 期待: 再びpass（復元確認）
```

`~/.task-memory.json` が存在しない環境では、存在する別の監視対象（`~/.review-memory.json`・`.git/task-memory.json` 等。worktreeの場合はrepo root直下の2ファイル）に読み替え、復元も(a)のbackupから行う。

## ファイル変更一覧

1. `test/setup.ts` - 新設（sandbox構築・環境差し替え（HOME・git系envの削除/設定）・fail-hard assert・SIGTERM handler + exit handlerによるworker終了時の自己削除）
2. `test/global-setup.ts` - 新設（監視対象5点のrun前後ハッシュ比較guard・受入専用probe `TEST_ISOLATION_GUARD_PROBE_PATH`）
3. `vitest.config.ts` - `test` block追加（environment / pool / isolate / fileParallelism / poolOptions / setupFiles / globalSetup）
4. `test/helpers.ts` - `createTempProject()` の生成先をsandbox HOME配下へ、`TMP_ROOT` 廃止、`getSandboxWorkDir()` 追加
5. `test/sync.test.ts` - HOME/GITブロック削除（sync領域リセットのafterEachは残置）、`TMP_ROOT` を `getSandboxWorkDir()` へ
6. `test/git_search.test.ts` - `vi.mock('os')` 撤廃、fixtureをsandbox配下の実ディレクトリへ
7. `test/global_mode.test.ts` - `/tmp` リテラルをsandbox配下へ、クリーンアップ簡素化
8. `test/commit.test.ts` - 冒頭describeの決定化
9. `test/README.md` - テスト隔離の節・ファイル一覧更新
10. `docs/README.md` - design/ 一覧に本ドキュメントを追記
11. `test/design/sync-setup.toml` - verify-conditions.py 実行による `source_lines` 自動同期のみ
12. `src/` - **無変更**。`package.json` も無変更

## 型安全規約への適合

- `as` キャスト・`any` 使用なし。`process.env` の読み取りは `string | undefined` のまま比較する
- setup.ts / global-setup.ts は `vitest/config`・Node標準APIのみをimportし、型注釈も明示する（`snapshotPath` の戻り値はunion型で `{ state: 'absent' } | { state: 'present'; hash: string; entries: number }` のように定義）

## 実装順序

各段階の完了時に `pnpm test` 全greenを確認してから次へ進む（段階1は既存テストが全てsandbox下で動くことの実証を兼ねる）。

1. `test/setup.ts` 作成 + `vitest.config.ts` に `environment / pool / isolate / setupFiles` を追加（`globalSetup` はまだ入れない）。既存テストはsetup導入のみで全greenになるはず（sync.test.ts の独自HOME差し替えはsandbox配下で二重に隔離されたまま動き、git_search のos mock・global_mode の `/tmp` fixtureも従来どおり動く）
2. `test/sync.test.ts`: HOME/GITブロック削除 + `TMP_ROOT` 差し替え
3. `test/helpers.ts`: sandbox HOME配下生成へ変更（14ファイルが追従することを全greenで確認）
4. `test/git_search.test.ts`: os mock撤廃・sandbox fixture化
5. `test/global_mode.test.ts`: sandbox前提化
6. `test/commit.test.ts`: 冒頭describe決定化
7. `test/global-setup.ts` 作成 + `vitest.config.ts` に `globalSetup` 追加
8. 受入手順 (a)-(d) を実施して隔離とguardの両方を受領
9. `python3 scripts/design/verify-conditions.py` 実行（`source_lines` 自動同期・PASS確認）
10. `test/README.md`・`docs/README.md` 更新
