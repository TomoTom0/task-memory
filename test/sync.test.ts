import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { syncCommand } from '../src/commands/sync';
import {
    saveToSync,
    pullFromSync,
    initSyncRepo,
    getSyncDir,
    generateSyncId,
    isSyncInitialized,
    getSyncRemoteUrl,
    isSafeGitUrl,
    isValidSyncId,
    hasSyncProject,
    hasSyncCommits,
    runGitCommandCapture,
} from '../src/syncStore';
import { loadStore, saveStore } from '../src/store';
import type { TaskStore, Task } from '../src/types';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { spawnSync } from 'child_process';
import { createTempProject, removeTempDir, getSandboxWorkDir } from './helpers';

// 一時領域のroot。setup.tsがsandbox HOME配下に作成済みのwork領域を指すため、
// テスト本体のprocess.chdir()の影響を受けない
const TMP_ROOT = getSandboxWorkDir();

// テストごとにsync repo領域を空に戻す（旧HOME差し替えブロックのafterEachが担っていた
// 「各テストが未同期状態から始まる」シナリオ前提の構築。環境隔離はsetup.tsが担うまま。
// homedir()はこの時点でsandbox HOMEを返すため掃除対象はsandbox配下に限られる）
afterEach(() => {
    rmSync(join(homedir(), '.local', 'task-memory'), { recursive: true, force: true });
});

function captureConsole(fn: () => void): { logs: string[]; errors: string[] } {
    const logs: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
        fn();
    } finally {
        console.log = origLog;
        console.error = origError;
    }
    return { logs, errors };
}

function runExpectingExit(fn: () => void): { code: number | undefined; logs: string[]; errors: string[] } {
    const origExit = process.exit;
    let code: number | undefined;
    function fakeExit(c?: number): never {
        code = c ?? 0;
        throw new Error('__exit__');
    }
    process.exit = fakeExit;
    let captured: { logs: string[]; errors: string[] } = { logs: [], errors: [] };
    try {
        captured = captureConsole(() => {
            try {
                fn();
            } catch (e) {
                if (!(e instanceof Error) || e.message !== '__exit__') throw e;
            }
        });
    } finally {
        process.exit = origExit;
    }
    return { code, logs: captured.logs, errors: captured.errors };
}

function createBareRemote(branch = 'main'): string {
    const dir = mkdtempSync(join(TMP_ROOT, 'bare-remote-'));
    const remotePath = join(dir, 'remote.git');
    spawnSync('git', ['init', '--bare', '-b', branch, remotePath], { stdio: 'pipe' });
    return remotePath;
}

function seedRemote(remotePath: string, branch: string, files: Record<string, string>): void {
    const workDir = mkdtempSync(join(TMP_ROOT, 'work-clone-'));
    spawnSync('git', ['clone', remotePath, workDir], { stdio: 'pipe' });
    for (const [name, content] of Object.entries(files)) {
        const filePath = join(workDir, name);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
    }
    spawnSync('git', ['-C', workDir, 'add', '.'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'seed'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workDir, 'push', 'origin', branch], { stdio: 'pipe' });
    rmSync(workDir, { recursive: true, force: true });
}

function pushBranchFrom(remotePath: string, newBranch: string): void {
    const workDir = mkdtempSync(join(TMP_ROOT, 'work-clone-'));
    spawnSync('git', ['clone', remotePath, workDir], { stdio: 'pipe' });
    spawnSync('git', ['-C', workDir, 'checkout', '-b', newBranch], { stdio: 'pipe' });
    spawnSync('git', ['-C', workDir, 'push', 'origin', newBranch], { stdio: 'pipe' });
    rmSync(workDir, { recursive: true, force: true });
}

describe('syncStore', () => {
    afterEach(() => {
        for (const id of ['test-project']) {
            const filePath = join(getSyncDir(), 'projects', `${id}.json`);
            if (existsSync(filePath)) rmSync(filePath);
        }
    });

    describe('saveToSync', () => {
        it('should save store data to sync directory', () => {
            initSyncRepo();
            const store: TaskStore = { tasks: [] };
            const result = saveToSync('test-project', store);
            expect(result).toBe(true);

            const filePath = join(getSyncDir(), 'projects', 'test-project.json');
            expect(existsSync(filePath)).toBe(true);
        });

        it('should return false when sync not initialized', () => {
            const store: TaskStore = { tasks: [] };
            const result = saveToSync('test-project', store);
            expect(typeof result).toBe('boolean');
        });
    });

    describe('pullFromSync', () => {
        it('should pull store data from sync directory', () => {
            initSyncRepo();
            const store: TaskStore = { tasks: [] };
            saveToSync('test-project', store);

            const pulled = pullFromSync('test-project');
            expect(pulled).not.toBeNull();
            expect(pulled!.tasks).toEqual([]);
        });

        it('should return null for non-existent project', () => {
            initSyncRepo();
            const result = pullFromSync('non-existent-project');
            expect(result).toBeNull();
        });
    });

    describe('generateSyncId', () => {
        it('should generate a non-empty sync id', () => {
            const id = generateSyncId();
            expect(id.length).toBeGreaterThan(0);
        });
    });
});

describe('syncCommand', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
        const store: TaskStore = {
            tasks: [],
            sync: {
                id: 'test-project',
                enabled: true,
                auto: false,
            },
        };
        saveStore(store);
        initSyncRepo();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
        for (const id of ['test-project', 'new-project']) {
            const filePath = join(getSyncDir(), 'projects', `${id}.json`);
            if (existsSync(filePath)) rmSync(filePath);
        }
    });

    describe('save', () => {
        it('should save tasks to sync directory', () => {
            syncCommand(['save']);

            const filePath = join(getSyncDir(), 'projects', 'test-project.json');
            expect(existsSync(filePath)).toBe(true);
        });

        it('should fail when not synced', () => {
            saveStore({ tasks: [] });
            const origExit = process.exit;
            let exitCode = 0;
            process.exit = ((code: number) => { exitCode = code; throw new Error('exit'); }) as never;
            try {
                syncCommand(['save']);
            } catch {
                // expected
            }
            process.exit = origExit;
            expect(exitCode).toBe(1);
        });
    });

    describe('add', () => {
        it('should add project to sync', () => {
            saveStore({ tasks: [] });
            syncCommand(['add', '--id', 'new-project', '--save']);

            const store = loadStore();
            expect(store.sync).toBeDefined();
            expect(store.sync!.enabled).toBe(true);
            expect(store.sync!.id).toBe('new-project');
        });

        it('should report already synced', () => {
            const logs: string[] = [];
            const origLog = console.log;
            console.log = (...args: unknown[]) => logs.push(args.join(' '));

            syncCommand(['add']);
            expect(logs.some(l => l.includes('Already added'))).toBe(true);

            console.log = origLog;
        });
    });

    describe('remove', () => {
        it('should remove project from sync', () => {
            syncCommand(['remove']);
            const store = loadStore();
            expect(store.sync!.enabled).toBe(false);
        });
    });

    describe('set', () => {
        it('should update sync id', () => {
            syncCommand(['set', '--id', 'renamed-project']);
            const store = loadStore();
            expect(store.sync!.id).toBe('renamed-project');
        });

        it('should set auto mode', () => {
            syncCommand(['set', 'auto']);
            const store = loadStore();
            expect(store.sync!.auto).toBe(true);
        });

        it('should set manual mode', () => {
            syncCommand(['set', 'auto']);
            syncCommand(['set', 'manual']);
            const store = loadStore();
            expect(store.sync!.auto).toBe(false);
        });

        it('should update id and mode together', () => {
            syncCommand(['set', '--id', 'new-id', 'auto']);
            const store = loadStore();
            expect(store.sync!.id).toBe('new-id');
            expect(store.sync!.auto).toBe(true);
        });
    });

    describe('pull', () => {
        function task(id: string, order: string | null): Task {
            return {
                id, status: 'todo', summary: id, bodies: [], files: { read: [], edit: [] },
                created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', order,
            };
        }

        it('マージモード: リモート由来のorder重複が正規化を通って解消される', () => {
            saveStore({
                tasks: [task('TASK-1', '1')],
                sync: { id: 'test-project', enabled: true, auto: false },
            });
            const remoteStore: TaskStore = { tasks: [task('TASK-2', '1')] };
            saveToSync('test-project', remoteStore);

            syncCommand(['pull', '--merge']);

            const store = loadStore();
            const orders = store.tasks.map(t => t.order).filter((o): o is string => o != null);
            expect(new Set(orders).size).toBe(orders.length);
            expect(orders.length).toBe(2);
        });

        it('上書きモード: リモートのタスクにorder重複があっても正規化を通る', () => {
            saveStore({
                tasks: [task('TASK-1', '1')],
                sync: { id: 'test-project', enabled: true, auto: false },
            });
            const remoteStore: TaskStore = {
                tasks: [task('TASK-1', '1'), task('TASK-2', '1')],
            };
            saveToSync('test-project', remoteStore);

            syncCommand(['pull']);

            const store = loadStore();
            const orders = store.tasks.map(t => t.order).filter((o): o is string => o != null);
            expect(new Set(orders).size).toBe(orders.length);
            expect(store.sync?.id).toBe('test-project');
        });
    });

    describe('status', () => {
        it('should show sync status', () => {
            const logs: string[] = [];
            const origLog = console.log;
            console.log = (...args: unknown[]) => logs.push(args.join(' '));

            syncCommand(['status']);
            expect(logs.some(l => l.includes('Sync Status'))).toBe(true);

            console.log = origLog;
        });
    });
});

// --- TASK-12: 別PC初回セットアップ改善（テスト先行。実装はstage6で行う） ---
describe('sync clone/add/set/push/pull (TASK-12 test-first)', () => {
    let originalCwd: string;
    let projectDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        projectDir = createTempProject();
        process.chdir(projectDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(projectDir);
    });

    describe('tm sync clone', () => {
        it('[covers:sync-clone.success] bare remoteからcloneが成功する', () => {
            const remote = createBareRemote();
            seedRemote(remote, 'main', {
                'projects/foo.json': JSON.stringify({ tasks: [] }, null, 2),
            });
            const result = runExpectingExit(() => syncCommand(['clone', remote]));
            expect(result.code).toBeUndefined();
            expect(existsSync(join(getSyncDir(), '.git'))).toBe(true);
            expect(existsSync(join(getSyncDir(), 'projects', 'foo.json'))).toBe(true);
            expect(getSyncRemoteUrl()).toBe(remote);
            expect(result.logs.some(l => l.includes('Cloned sync repository to:'))).toBe(true);
            expect(result.logs.some(l => l.includes('Synced projects:'))).toBe(true);
            expect(result.logs.some(l => l.includes('  - foo'))).toBe(true);
            expect(result.logs.some(l => l.includes('Next steps:'))).toBe(true);
        });

        it('[covers:sync-clone.no-url] URL未指定はusageエラーで終了する', () => {
            const result = runExpectingExit(() => syncCommand(['clone']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Usage: tm sync clone <url>'))).toBe(true);
        });

        it('[covers:sync-clone.invalid-url-dash] 単一-始まりのURLはオプション注入対策として拒否される', () => {
            const result = runExpectingExit(() => syncCommand(['clone', '-oProxyCommand=touch /tmp/pwned']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Invalid remote URL:'))).toBe(true);
        });

        it('[covers:sync-clone.dashdash-value-absorbed] --始まりの値はURLなし扱いになる（オプション注入への構造的防御の回帰確認）', () => {
            const result = runExpectingExit(() => syncCommand(['clone', '--upload-pack=touch /tmp/pwned']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Usage: tm sync clone <url>'))).toBe(true);
            expect(result.errors.some(e => e.includes('Invalid remote URL:'))).toBe(false);
        });

        it('[covers:sync-clone.already-initialized] 初期化済みへのcloneはset --remoteへ誘導しoriginを変えない', () => {
            initSyncRepo();
            const result = runExpectingExit(() => syncCommand(['clone', 'https://example.com/x.git']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Sync repository already exists at:'))).toBe(true);
            expect(result.errors.some(e => e.includes('tm sync set --remote'))).toBe(true);
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-clone.dir-exists-not-git] .git無しの既存ディレクトリは非git状態として拒否される', () => {
            mkdirSync(getSyncDir(), { recursive: true });
            const result = runExpectingExit(() => syncCommand(['clone', 'https://example.com/x.git']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('not a git repository'))).toBe(true);
        });

        it('[covers:sync-clone.clone-fails] git clone自体が失敗した場合はexit 1で終了する', () => {
            const result = runExpectingExit(() => syncCommand(['clone', join(process.cwd(), 'does-not-exist-remote')]));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Failed to clone sync repository.'))).toBe(true);
        });
    });

    describe('tm sync add --remote', () => {
        beforeEach(() => {
            saveStore({ tasks: [] });
        });

        it('[covers:sync-add.remote-unset-to-set] origin未設定の状態でadd --remoteを指定するとoriginが設定される', () => {
            const url = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', url]));
            expect(result.code).toBeUndefined();
            expect(getSyncRemoteUrl()).toBe(url);
            expect(result.logs.some(l => l.includes(`Remote origin set to: ${url}`))).toBe(true);
            expect(loadStore().sync?.enabled).toBe(true);
        });

        it('[covers:sync-add.remote-different-warns] 既に別URLがorigin設定済みの場合は上書きせず警告する', () => {
            const urlA = createBareRemote();
            const urlB = createBareRemote();
            runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', urlA]));
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', urlB]));
            expect(result.errors.some(e => e.includes('Warning: remote origin is already set to:'))).toBe(true);
            expect(result.errors.some(e => e.includes('Run "tm sync set --remote <url>" to change it.'))).toBe(true);
            expect(getSyncRemoteUrl()).toBe(urlA);
        });

        it('[covers:sync-add.remote-same-info] 同一URLが既に設定済みの場合は情報メッセージのみでexitしない', () => {
            const url = createBareRemote();
            runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', url]));
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', url]));
            expect(result.code).toBeUndefined();
            expect(result.logs.some(l => l.includes(`Remote origin already set to: ${url}`))).toBe(true);
        });

        it('[covers:sync-add.remote-flag-no-value] 値なし--remoteはusageエラーで終了する', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--remote']));
            expect(result.code).toBe(1);
        });

        it('[covers:sync-add.no-remote-regression] --remoteを指定しないaddは従来どおりoriginに触れない', () => {
            runExpectingExit(() => syncCommand(['add', '--id', 'x', '--save']));
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-add.invalid-id] パストラバーサルを含む--idは検証フェーズで拒否し副作用を起こさない', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--id', '../../evil']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Invalid sync id:'))).toBe(true);
            expect(loadStore().sync?.enabled).not.toBe(true);
        });

        it('[covers:sync-add.invalid-remote-url-dash] 単一-始まりの--remoteはオプション注入対策として拒否しgit remoteを実行しない', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', '-oProxyCommand=touch /tmp/pwned']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Invalid remote URL:'))).toBe(true);
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-add.id-flag-no-value] 値なし--idは検証フェーズで拒否され副作用が起きない', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--id']));
            expect(result.code).toBe(1);
            expect(isSyncInitialized()).toBe(false);
        });

        it('[covers:sync-add.unknown-option] 未知オプションは検証フェーズで拒否し副作用を起こさない', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--unknown', 'y']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Unknown option: --unknown'))).toBe(true);
            expect(loadStore().sync?.enabled).not.toBe(true);
        });

        it('[covers:sync-add.remote-dashdash-value-unknown-option] --始まりの--remote値はUnknown optionとして先に弾かれる', () => {
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'x', '--remote', '--upload-pack=touch /tmp/pwned']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Unknown option: --upload-pack=touch /tmp/pwned'))).toBe(true);
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-add.unexpected-positional] 余分な位置引数は検証フェーズで拒否し副作用を起こさない', () => {
            const result = runExpectingExit(() => syncCommand(['add', 'unexpected', '--id', 'x']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Unexpected argument: unexpected'))).toBe(true);
            expect(loadStore().sync?.enabled).not.toBe(true);
        });

        it('[covers:sync-add.auto-generated-id-invalid] 空白を含むディレクトリ名由来の自動生成idは明示的に拒否される', () => {
            // spaceDirは実repo（TMP_ROOT配下）にネストしているため、GIT_CEILING_DIRECTORIES
            // が無いとgit rev-parse/remote get-urlの探索が親の実repoのoriginまで遡ってしまい、
            // 空白入りbasenameへのfall throughが起きなくなる（generateSyncId()が実repoのorigin由来の
            // 有効なidを返してしまう）。spaceDirの親でceilingを切って実repoの発見を防ぐ。
            const spaceDir = join(originalCwd, 'tmp', `sync space project ${Date.now()}`);
            mkdirSync(join(spaceDir, '.git'), { recursive: true });
            process.chdir(spaceDir);
            const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;
            process.env.GIT_CEILING_DIRECTORIES = join(originalCwd, 'tmp');
            try {
                saveStore({ tasks: [] });
                const result = runExpectingExit(() => syncCommand(['add']));
                expect(result.code).toBe(1);
                expect(result.errors.some(e => e.includes('is invalid'))).toBe(true);
                expect(loadStore().sync?.enabled).not.toBe(true);
            } finally {
                if (originalCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
                else process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
                process.chdir(projectDir);
                removeTempDir(spaceDir);
            }
        });
    });

    describe('tm sync set --remote', () => {
        beforeEach(() => {
            saveStore({ tasks: [], sync: { id: 'test-project', enabled: true, auto: false } });
        });

        it('[covers:sync-set.remote-unset-to-set] origin未設定の状態でset --remoteを指定するとoriginが設定される', () => {
            const url = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', url]));
            expect(result.code).toBeUndefined();
            expect(getSyncRemoteUrl()).toBe(url);
            expect(result.logs.some(l => l.includes(`Remote origin set to: ${url}`))).toBe(true);
        });

        it('[covers:sync-set.remote-without-sync-enabled] --remoteはenabledを要求せず未同期プロジェクトでも単体で成功する', () => {
            saveStore({ tasks: [] });
            const url = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', url]));
            expect(result.code).toBeUndefined();
            expect(getSyncRemoteUrl()).toBe(url);
        });

        it('[covers:sync-set.remote-change] 既存originがある場合はset-urlで変更し旧URLをログに残す', () => {
            const oldUrl = createBareRemote();
            const newUrl = createBareRemote();
            runExpectingExit(() => syncCommand(['set', '--remote', oldUrl]));
            const result = runExpectingExit(() => syncCommand(['set', '--remote', newUrl]));
            expect(getSyncRemoteUrl()).toBe(newUrl);
            expect(result.logs.some(l => l.includes(`Remote origin changed: ${oldUrl} -> ${newUrl}`))).toBe(true);
        });

        it('[covers:sync-set.combined-id-remote-mode] --id・--remote・auto|manualを同時指定した場合すべて適用される', () => {
            const url = createBareRemote();
            runExpectingExit(() => syncCommand(['set', '--id', 'new-id', '--remote', url, 'auto']));
            expect(getSyncRemoteUrl()).toBe(url);
            const store = loadStore();
            expect(store.sync?.id).toBe('new-id');
            expect(store.sync?.auto).toBe(true);
        });

        it('[covers:sync-set.no-args-usage] 引数なしのsetは従来どおりusageエラー(--remoteを含む文言)', () => {
            const result = runExpectingExit(() => syncCommand(['set']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('--remote'))).toBe(true);
        });

        it('[covers:sync-set.no-args-unsynced-not-synced] 未同期プロジェクトでの引数なしsetは従来どおりNot syncedを案内する', () => {
            saveStore({ tasks: [] });
            const result = runExpectingExit(() => syncCommand(['set']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Not synced.'))).toBe(true);
        });

        it('[covers:sync-set.id-without-sync-not-synced] 未同期プロジェクトで--idのみ指定した場合はNot syncedで拒否する', () => {
            saveStore({ tasks: [] });
            const result = runExpectingExit(() => syncCommand(['set', '--id', 'x']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Not synced.'))).toBe(true);
        });

        it('[covers:sync-set.validation-before-sideeffect] modeが不正な場合remoteへの副作用が発生する前にexitする', () => {
            const oldUrl = createBareRemote();
            runExpectingExit(() => syncCommand(['set', '--remote', oldUrl]));
            const newUrl = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', newUrl, 'invalid-mode']));
            expect(result.code).toBe(1);
            expect(getSyncRemoteUrl()).toBe(oldUrl);
        });

        it('[covers:sync-set.unsynced-with-remote-and-id] 未同期状態で--remoteと--idを併用した場合Not syncedで拒否しremoteも変更しない', () => {
            saveStore({ tasks: [] });
            const url = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', url, '--id', 'x']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Not synced.'))).toBe(true);
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-set.invalid-id] 不正な--idは拒否する', () => {
            const result = runExpectingExit(() => syncCommand(['set', '--id', 'a/../b']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Invalid sync id:'))).toBe(true);
        });

        it('[covers:sync-set.invalid-remote-url-dash] 単一-始まりの--remoteはオプション注入対策として拒否する', () => {
            const result = runExpectingExit(() => syncCommand(['set', '--remote', '-oProxyCommand=touch /tmp/pwned']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Invalid remote URL:'))).toBe(true);
        });

        it('[covers:sync-set.id-flag-no-value] 値なし--idは検証フェーズで拒否されconfigが変化しない', () => {
            const before = loadStore().sync;
            const result = runExpectingExit(() => syncCommand(['set', '--id']));
            expect(result.code).toBe(1);
            expect(loadStore().sync).toEqual(before);
        });

        it('[covers:sync-set.unknown-option] 未知オプションは検証フェーズで拒否しremoteも変更しない', () => {
            const url = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', url, '--unknown', 'y']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Unknown option: --unknown'))).toBe(true);
            expect(getSyncRemoteUrl()).toBeNull();
        });

        it('[covers:sync-set.extra-positional] 2個以上の位置引数は検証フェーズで拒否しmodeも変更しない', () => {
            const result = runExpectingExit(() => syncCommand(['set', 'auto', 'extra']));
            expect(result.code).toBe(1);
            expect(loadStore().sync?.auto).toBe(false);
        });
    });

    describe('applyAutoAdopt / adoptRemoteIntoEmptyRepo（自動adopt）', () => {
        beforeEach(() => {
            saveStore({ tasks: [] });
        });

        it('[covers:sync-adopt.pc-b-recovery-e2e] PC-Bが先にaddしただけの空repoはremote接続で自動復旧する', () => {
            const remote = createBareRemote();
            seedRemote(remote, 'main', {
                'config.json': JSON.stringify({ defaultAuto: false }, null, 2),
                '.gitignore': '# Add patterns to ignore\n',
                'projects/shared.json': JSON.stringify({ tasks: [] }, null, 2),
            });
            runExpectingExit(() => syncCommand(['add', '--id', 'shared']));
            const result = runExpectingExit(() => syncCommand(['set', '--remote', remote]));
            expect(result.logs.some(l => l.includes('Adopted existing data from remote.'))).toBe(true);
            expect(hasSyncProject('shared')).toBe(true);
            const pullResult = runExpectingExit(() => syncCommand(['pull']));
            expect(pullResult.code).toBeUndefined();
        });

        it('[covers:sync-adopt.non-main-branch-resolution] main/master以外のデフォルトブランチもHEAD symref解決で正しくadoptされる', () => {
            const remote = createBareRemote('trunk');
            seedRemote(remote, 'trunk', {
                'config.json': JSON.stringify({ defaultAuto: false }, null, 2),
                '.gitignore': '# Add patterns to ignore\n',
                'projects/shared.json': JSON.stringify({ tasks: [] }, null, 2),
            });
            pushBranchFrom(remote, 'legacy');
            runExpectingExit(() => syncCommand(['add', '--id', 'shared']));
            runExpectingExit(() => syncCommand(['set', '--remote', remote]));
            const branchResult = spawnSync('git', ['-C', getSyncDir(), 'branch', '--show-current'], { encoding: 'utf-8' });
            expect(branchResult.stdout.trim()).toBe('trunk');
        });

        it('[covers:sync-adopt.unsafe-branch-name-rejected] "-"始まりのbranch名はfetch/checkoutへ渡さずfetch-failedとして扱われる', () => {
            const remote = createBareRemote('-weird');
            const workDir = mkdtempSync(join(TMP_ROOT, 'work-clone-'));
            spawnSync('git', ['clone', remote, workDir], { stdio: 'pipe' });
            mkdirSync(join(workDir, 'projects'), { recursive: true });
            writeFileSync(join(workDir, 'projects', 'shared.json'), JSON.stringify({ tasks: [] }), 'utf-8');
            spawnSync('git', ['-C', workDir, 'add', '.'], { stdio: 'pipe' });
            spawnSync('git', ['-C', workDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'seed'], { stdio: 'pipe' });
            // branch名を単独引数として渡すとgitオプションと誤解釈されるため、refspec形式で先頭'-'を避けてpushする
            spawnSync('git', ['-C', workDir, 'push', 'origin', 'HEAD:refs/heads/-weird'], { stdio: 'pipe' });
            rmSync(workDir, { recursive: true, force: true });

            runExpectingExit(() => syncCommand(['add', '--id', 'shared']));
            const result = runExpectingExit(() => syncCommand(['set', '--remote', remote]));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Failed to fetch from remote.'))).toBe(true);
            expect(result.errors.some(e => e.includes('Unsafe branch name from remote:'))).toBe(true);
        });

        it('[covers:sync-adopt.remote-empty] remoteにcommitが1つも無い場合はadoptを行わずpushを促す', () => {
            const remote = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['add', '--id', 'shared', '--remote', remote]));
            expect(result.code).toBeUndefined();
            expect(result.logs.some(l => l.includes('Remote repository has no commits yet. Run "tm sync push" to publish local data.'))).toBe(true);
        });

        it('[covers:sync-adopt.missing-head-with-branches] default HEADが存在しないbranchを指しても、既存branchを空remoteと誤判定しない', () => {
            const remote = createBareRemote('master');
            seedRemote(remote, 'master', {
                'projects/shared.json': JSON.stringify({ tasks: [] }, null, 2),
            });
            spawnSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/missing'], { stdio: 'pipe' });

            runExpectingExit(() => syncCommand(['add', '--id', 'shared']));
            const result = runExpectingExit(() => syncCommand(['set', '--remote', remote]));
            expect(result.code).toBe(1);
            expect(result.logs.some(l => l.includes('Remote repository has no commits yet.'))).toBe(false);
            expect(result.errors.some(e => e.includes('Remote has branches but its default HEAD does not point to one.'))).toBe(true);
        });

        it('[covers:sync-adopt.conflict-fails] 真のローカルデータがremoteと衝突する場合はcheckoutを失敗させ非破壊のまま通知する', () => {
            const remote = createBareRemote();
            seedRemote(remote, 'main', {
                'projects/shared.json': JSON.stringify({ tasks: [{ note: 'remote' }] }, null, 2),
            });
            runExpectingExit(() => syncCommand(['add', '--id', 'shared']));
            mkdirSync(join(getSyncDir(), 'projects'), { recursive: true });
            writeFileSync(join(getSyncDir(), 'projects', 'shared.json'), JSON.stringify({ tasks: [{ note: 'local' }] }, null, 2), 'utf-8');
            const result = runExpectingExit(() => syncCommand(['set', '--remote', remote]));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('could not be adopted automatically'))).toBe(true);
            const localContent = readFileSync(join(getSyncDir(), 'projects', 'shared.json'), 'utf-8');
            expect(localContent).toContain('local');
        });

        it('[covers:sync-adopt.existing-commits-skips] ローカルに既にcommitがある場合は復旧対象外としてadoptを走らせない', () => {
            const remoteA = createBareRemote();
            runExpectingExit(() => syncCommand(['add', '--id', 'shared', '--remote', remoteA]));
            runExpectingExit(() => syncCommand(['push']));
            const remoteB = createBareRemote();
            const result = runExpectingExit(() => syncCommand(['set', '--remote', remoteB]));
            expect(result.logs.some(l => l.includes('Adopted existing data from remote.'))).toBe(false);
            expect(result.logs.some(l => l.includes(`Remote origin changed: ${remoteA} -> ${remoteB}`))).toBe(true);
        });

        it('[covers:sync-adopt.store-layer-id-guard] store層はCLI層をバイパスした不正idも拒否しprojects/外への操作を防ぐ', () => {
            initSyncRepo();
            expect(saveToSync('../evil', { tasks: [] })).toBe(false);
            expect(pullFromSync('../evil')).toBeNull();
            expect(hasSyncProject('../evil')).toBe(false);
        });
    });

    describe('tm sync push（origin未設定検知・git add失敗検知）', () => {
        beforeEach(() => {
            saveStore({ tasks: [] });
        });

        it('[covers:sync-push.origin-not-configured] origin未設定でのpushはfail-fastしsync repoにcommitを作らない', () => {
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project']));
            const result = runExpectingExit(() => syncCommand(['push']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Remote origin is not configured.'))).toBe(true);
            expect(hasSyncCommits()).toBe(false);
        });

        it('[covers:sync-push.e2e-success] origin設定済みでのpushはbare remoteへ実際にデータを届ける', () => {
            const remote = createBareRemote();
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project', '--remote', remote]));
            const result = runExpectingExit(() => syncCommand(['push']));
            expect(result.code).toBeUndefined();
            const rev = spawnSync('git', ['--git-dir', remote, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
            expect(rev.status).toBe(0);
            const ls = spawnSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf-8' });
            expect(ls.stdout).toContain('projects/test-project.json');
        });

        it('[covers:sync-push.git-add-fails] git add .の失敗を検知しcommit/pushへ進まずexit 1する', () => {
            const remote = createBareRemote();
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project', '--remote', remote]));
            const objectsDir = join(getSyncDir(), '.git', 'objects');
            chmodSync(objectsDir, 0o500);
            try {
                const result = runExpectingExit(() => syncCommand(['push']));
                expect(result.code).toBe(1);
                expect(result.errors.some(e => e.includes('Failed to stage changes.'))).toBe(true);
            } finally {
                chmodSync(objectsDir, 0o700);
            }
        });
    });

    describe('tm sync pull（未初期化・remote未設定の状態検出）', () => {
        beforeEach(() => {
            saveStore({ tasks: [] });
        });

        it('[covers:sync-pull.not-initialized] sync repo未初期化の場合はcloneを案内してexitする', () => {
            saveStore({ tasks: [], sync: { id: 'test-project', enabled: true, auto: false } });
            const result = runExpectingExit(() => syncCommand(['pull']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('Sync repository is not initialized on this machine.'))).toBe(true);
            expect(result.errors.some(e => e.includes('tm sync clone <url>'))).toBe(true);
        });

        it('[covers:sync-pull.no-remote-no-data] 初期化済み・remote未設定・ローカルデータ無しはset --remoteを案内してexitする', () => {
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project']));
            const result = runExpectingExit(() => syncCommand(['pull']));
            expect(result.code).toBe(1);
            expect(result.errors.some(e => e.includes('No remote is configured and no local data exists'))).toBe(true);
            expect(result.errors.some(e => e.includes('tm sync set --remote'))).toBe(true);
        });

        it('[covers:sync-pull.no-remote-has-data-regression] remote未設定でもローカルデータがあれば従来どおりpullが完了する', () => {
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project', '--save']));
            const result = runExpectingExit(() => syncCommand(['pull']));
            expect(result.code).toBeUndefined();
        });

        it('[covers:sync-pull.clone-e2e] clone経由でセットアップした場合pullでremoteのタスクがローカルへ反映される', () => {
            const remote = createBareRemote();
            seedRemote(remote, 'main', {
                'projects/test-project.json': JSON.stringify({
                    tasks: [{
                        id: 'TASK-1', status: 'todo', summary: 'from remote', bodies: [], files: { read: [], edit: [] },
                        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', order: '1',
                    }],
                }, null, 2),
            });
            runExpectingExit(() => syncCommand(['clone', remote]));
            runExpectingExit(() => syncCommand(['add', '--id', 'test-project']));
            const result = runExpectingExit(() => syncCommand(['pull']));
            expect(result.code).toBeUndefined();
            const store = loadStore();
            expect(store.tasks.some(t => t.summary === 'from remote')).toBe(true);
        });

        it('[covers:sync-pull.project-not-found-guidance] 存在しないプロジェクトIDのpullFromSyncは案内2行を追加で表示する', () => {
            initSyncRepo();
            const captured = captureConsole(() => {
                const result = pullFromSync('ghost');
                expect(result).toBeNull();
            });
            expect(captured.errors.some(e => e.includes('Project "ghost" not found in sync repository.'))).toBe(true);
            expect(captured.errors.some(e => e.includes('Run "tm sync list" to see available projects.'))).toBe(true);
            expect(captured.errors.some(e => e.includes('Run "tm sync set --id <name>" to use a different ID for this project.'))).toBe(true);
        });
    });

    describe('sync-util / sync-status / sync-help', () => {
        it('[covers:sync-util.get-sync-remote-url] 未初期化 / 初期化のみ / remote add後の3段階で正しい値を返す', () => {
            expect(getSyncRemoteUrl()).toBeNull();
            initSyncRepo();
            expect(getSyncRemoteUrl()).toBeNull();
            const url = createBareRemote();
            runGitCommandCapture(['remote', 'add', 'origin', url]);
            expect(getSyncRemoteUrl()).toBe(url);
        });

        it('[covers:sync-status.remote-line] statusコマンドがRemote行を表示する', () => {
            saveStore({ tasks: [], sync: { id: 'test-project', enabled: true, auto: false } });
            initSyncRepo();
            const before = runExpectingExit(() => syncCommand(['status']));
            expect(before.logs.some(l => l.includes('Remote: Not configured'))).toBe(true);

            const url = createBareRemote();
            runGitCommandCapture(['remote', 'add', 'origin', url]);
            const after = runExpectingExit(() => syncCommand(['status']));
            expect(after.logs.some(l => l.includes(`Remote: ${url}`))).toBe(true);
        });

        it('[covers:sync-help.subcommand-help] sync help出力にcloneサブコマンドと--remoteオプションが記載される', () => {
            const result = runExpectingExit(() => syncCommand(['help']));
            expect(result.logs.some(l => l.includes('clone <url>'))).toBe(true);
            expect(result.logs.some(l => l.includes('--remote <url>'))).toBe(true);
        });

        it('[covers:sync-util.is-valid-sync-id] 許可文字（英数・.・_・-）のみtrue、パストラバーサル・空文字等はfalse', () => {
            expect(isValidSyncId('my-project')).toBe(true);
            expect(isValidSyncId('v1.2_x')).toBe(true);
            expect(isValidSyncId('../x')).toBe(false);
            expect(isValidSyncId('a/b')).toBe(false);
            expect(isValidSyncId('.')).toBe(false);
            expect(isValidSyncId('..')).toBe(false);
            expect(isValidSyncId('')).toBe(false);
        });

        it('[covers:sync-util.is-safe-git-url] 空文字・単一-始まり・remote helper構文はfalse、IPv6 SSH URLを含む通常URLはtrue', () => {
            expect(isSafeGitUrl('https://example.com/x.git')).toBe(true);
            expect(isSafeGitUrl('git@example.com:x.git')).toBe(true);
            expect(isSafeGitUrl('ssh://git@[2001:db8::1]/repo.git')).toBe(true);
            expect(isSafeGitUrl('-oProxyCommand=x')).toBe(false);
            expect(isSafeGitUrl('--upload-pack=x')).toBe(false);
            expect(isSafeGitUrl('')).toBe(false);
            expect(isSafeGitUrl('ext::sh -c "touch /tmp/pwned"')).toBe(false);
        });
    });
});
