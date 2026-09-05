import { join, sep } from 'path';
import { homedir, tmpdir } from 'os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { afterAll } from 'vitest';
import { resolveGitPath } from '../src/store';

// テスト隔離のsandbox（設計書: docs/design/test-isolation.md）。
// 全テストファイルのHOME・cwdはこの配下に限定され、実データ
// （repo側DB・~/.local/task-memory・~/.task-memory.json等）へは到達しない
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
    'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
    'GIT_TEMPLATE_DIR',   // 親環境のtemplate（実行可能hook含む）がgit initでsandbox repoへコピーされるのを防ぐ
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
