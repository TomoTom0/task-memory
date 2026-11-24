import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    getSyncDir,
    getLegacySyncDir,
    getMigrationMarkerPath,
    hasSyncData,
    getDirectoryState,
    decideLegacySyncDirMigration,
    migrateLegacySyncDir,
    copyDirThenRemove,
    tryAutoSync,
} from '../src/syncStore';
import { syncCommand } from '../src/commands/sync';
import { gitCommand } from '../src/commands/git';
import type { TaskStore } from '../src/types';
import { join, dirname, sep } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync, symlinkSync, readlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { getSandboxWorkDir } from './helpers';

// env-pathsのmock。既定は実装へpassthroughし、envPathsDataDirを設定すると
// envPaths().dataの戻り値だけを差し替えられる（OS判定の注入。実機がLinuxしかない
// ため、macOS/Windows相当のパスはこの差し替えで与える）
type EnvPathsOptions = { suffix?: string };
let envPathsDataDir: string | null = null;
const envPathsCalls: { name: string; suffix: string | undefined }[] = [];

vi.mock('env-paths', async (importOriginal) => {
    const actual = await importOriginal<typeof import('env-paths')>();
    return {
        default: (name: string, options?: EnvPathsOptions) => {
            envPathsCalls.push({ name, suffix: options?.suffix });
            const paths = actual.default(name, options);
            if (envPathsDataDir !== null) {
                return { ...paths, data: envPathsDataDir };
            }
            return paths;
        },
    };
});

const TMP_ROOT = getSandboxWorkDir();

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

// 旧同期ディレクトリ（~/.local/task-memory）にファイル群を作る
function createLegacyFiles(files: Record<string, string>): string {
    const legacy = getLegacySyncDir();
    for (const [name, content] of Object.entries(files)) {
        const filePath = join(legacy, name);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
    }
    return legacy;
}

function writeFilesAt(base: string, files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
        const filePath = join(base, name);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, content, 'utf-8');
    }
}

// .migrated-from markerの内容（型ガードでasキャストなしにparseする）
function parseMigrationRecord(path: string): { from: string; to: string; migratedAt: string } | null {
    let text: string;
    try {
        text = readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!('from' in parsed) || typeof parsed.from !== 'string') return null;
    if (!('to' in parsed) || typeof parsed.to !== 'string') return null;
    if (!('migratedAt' in parsed) || typeof parsed.migratedAt !== 'string') return null;
    return { from: parsed.from, to: parsed.to, migratedAt: parsed.migratedAt };
}

afterEach(() => {
    envPathsDataDir = null;
    envPathsCalls.length = 0;
    delete process.env.XDG_DATA_HOME;
    // 旧パス・新パス（env-paths解決）の両方を掃除する（sandbox HOME配下）
    rmSync(getLegacySyncDir(), { recursive: true, force: true });
    rmSync(getSyncDir(), { recursive: true, force: true });
});

// --- パス決定 ---

describe('同期ディレクトリのパス決定', () => {
    it('getSyncDirはenvPaths("task-memory", {suffix: ""})のdataを返す [covers:syncdir-paths.env-paths-contract]', () => {
        envPathsDataDir = join(sep, 'mock', 'data', 'dir');
        expect(getSyncDir()).toBe(join(sep, 'mock', 'data', 'dir'));
        // suffix "" の指定を欠くと task-memory-nodejs になるため、呼び出し契約を固定する
        expect(envPathsCalls[envPathsCalls.length - 1]).toEqual({ name: 'task-memory', suffix: '' });
    });

    it('OSごとのdata pathはenv-pathsの解決に委譲し、旧パスは全OSで~/.local/task-memory [covers:syncdir-paths.os-delegation]', () => {
        // macOS相当
        envPathsDataDir = '/Users/example/Library/Application Support/task-memory';
        expect(getSyncDir()).toBe('/Users/example/Library/Application Support/task-memory');
        expect(getLegacySyncDir()).toBe(join(homedir(), '.local', 'task-memory'));
        // Windows相当（env-paths v4はdataに%LOCALAPPDATA%を使う）
        envPathsDataDir = 'C:\\Users\\example\\AppData\\Local\\task-memory\\Data';
        expect(getSyncDir()).toBe('C:\\Users\\example\\AppData\\Local\\task-memory\\Data');
        expect(getLegacySyncDir()).toBe(join(homedir(), '.local', 'task-memory'));
    });

    it.skipIf(process.platform !== 'linux')(
        '実Linux解決: XDG_DATA_HOME無しは~/.local/share/task-memory、有りは$XDG_DATA_HOME配下 [covers:syncdir-paths.linux-xdg]',
        () => {
            delete process.env.XDG_DATA_HOME;
            // sandbox HOME配下に解決されること（隔離canaryを兼ねる）
            expect(getSyncDir()).toBe(join(homedir(), '.local', 'share', 'task-memory'));
            const xdg = join(TMP_ROOT, `xdg-data-${randomUUID().slice(0, 8)}`);
            process.env.XDG_DATA_HOME = xdg;
            expect(getSyncDir()).toBe(join(xdg, 'task-memory'));
        }
    );
});

// --- 移行判定（純粋関数） ---

describe('旧同期ディレクトリ移行の判定', () => {
    it('状態の組合せからmove/none/conflictを正しく決める [covers:syncdir-migration.decision]', () => {
        // 旧dirが無い: 新規ユーザー・移行済み。何もしない
        expect(decideLegacySyncDirMigration({ legacyExists: false, legacyHasData: false, targetState: 'absent' }))
            .toEqual({ action: 'none', reason: 'legacy-absent' });
        expect(decideLegacySyncDirMigration({ legacyExists: false, legacyHasData: true, targetState: 'non-empty' }))
            .toEqual({ action: 'none', reason: 'legacy-absent' });
        // 新dirが無い: そのままmove
        expect(decideLegacySyncDirMigration({ legacyExists: true, legacyHasData: true, targetState: 'absent' }))
            .toEqual({ action: 'move', clearEmptyTarget: false });
        // 新dirが空dir: 空dirを除去してからmove
        expect(decideLegacySyncDirMigration({ legacyExists: true, legacyHasData: true, targetState: 'empty' }))
            .toEqual({ action: 'move', clearEmptyTarget: true });
        // 両dirにデータ: 上書き事故防止のため衝突
        expect(decideLegacySyncDirMigration({ legacyExists: true, legacyHasData: true, targetState: 'non-empty' }))
            .toEqual({ action: 'conflict' });
        // 旧dirにtmのデータが無く新dirが有効: 旧dirは無視
        expect(decideLegacySyncDirMigration({ legacyExists: true, legacyHasData: false, targetState: 'non-empty' }))
            .toEqual({ action: 'none', reason: 'legacy-no-data' });
    });

    it('hasSyncDataは.git/projects/config.jsonの有無で判定し、getDirectoryStateはabsent/empty/non-emptyを返す [covers:syncdir-migration.dir-state]', () => {
        const dir = join(TMP_ROOT, `dir-state-${randomUUID().slice(0, 8)}`);
        expect(getDirectoryState(dir)).toBe('absent');
        expect(hasSyncData(dir)).toBe(false);
        mkdirSync(dir, { recursive: true });
        expect(getDirectoryState(dir)).toBe('empty');
        expect(hasSyncData(dir)).toBe(false);
        writeFilesAt(dir, { 'notes.txt': 'x' });
        expect(getDirectoryState(dir)).toBe('non-empty');
        expect(hasSyncData(dir)).toBe(false);
        writeFilesAt(dir, { 'config.json': '{}' });
        expect(hasSyncData(dir)).toBe(true);
    });
});

// --- 移行の実行 ---

describe('旧同期ディレクトリ移行の実行', () => {
    it('旧dirのデータを新dirへ移行し、markerを残してgit repoとして機能し続ける [covers:syncdir-migration.e2e-move]', () => {
        const legacy = createLegacyFiles({
            'projects/shared.json': '{"tasks":[]}',
            'config.json': '{"defaultAuto":false}',
        });
        expect(spawnSync('git', ['init', legacy]).status).toBe(0);
        const target = getSyncDir();

        const captured = captureConsole(() => {
            expect(migrateLegacySyncDir()).toEqual({ kind: 'migrated', from: legacy, to: target });
        });
        expect(captured.logs.some(l => l.includes('Migrated sync data directory'))).toBe(true);

        // 旧dirは消え、新dirにデータが届いている
        expect(existsSync(legacy)).toBe(false);
        expect(readFileSync(join(target, 'projects', 'shared.json'), 'utf-8')).toBe('{"tasks":[]}');
        // git repoとして引き続き機能する
        expect(spawnSync('git', ['-C', target, 'rev-parse', '--git-dir']).status).toBe(0);
        // markerに出所・移行先・日時が記録され、gitの追跡対象から外されている
        const marker = parseMigrationRecord(getMigrationMarkerPath());
        expect(marker?.from).toBe(legacy);
        expect(marker?.to).toBe(target);
        expect(typeof marker?.migratedAt).toBe('string');
        const exclude = readFileSync(join(target, '.git', 'info', 'exclude'), 'utf-8');
        expect(exclude.split('\n')).toContain('.migrated-from');
    });

    it('相対パスのremote URLは移行時に旧dir基準の絶対パスへ解決して保持する [covers:syncdir-migration.relative-remote-url]', () => {
        const legacy = createLegacyFiles({ 'config.json': '{"defaultAuto":false}' });
        expect(spawnSync('git', ['init', legacy]).status).toBe(0);
        // 旧dirから ../remote.git の位置にbare repoを作り、相対パスでorigin登録する
        const remotePath = join(dirname(legacy), 'remote.git');
        expect(spawnSync('git', ['init', '--bare', remotePath]).status).toBe(0);
        expect(spawnSync('git', ['-C', legacy, 'remote', 'add', 'origin', '../remote.git']).status).toBe(0);
        // 絶対パス・URLのremoteは移行の影響を受けないこともあわせて固定する
        expect(spawnSync('git', ['-C', legacy, 'remote', 'add', 'abs', remotePath]).status).toBe(0);
        expect(spawnSync('git', ['-C', legacy, 'remote', 'add', 'web', 'https://example.com/x.git']).status).toBe(0);
        try {
            // 移行前は相対パスでも到達できる
            expect(spawnSync('git', ['-C', legacy, 'ls-remote', 'origin']).status).toBe(0);
            // 明示pushurlも保持対象: fetch URLは絶対パス・pushurlのみ相対パスのremoteと、
            // 非相対（https://）のpushurlを持つremoteを追加する
            expect(spawnSync('git', ['-C', legacy, 'remote', 'add', 'pushy', remotePath]).status).toBe(0);
            expect(spawnSync('git', ['-C', legacy, 'remote', 'set-url', '--push', 'pushy', '../remote.git']).status).toBe(0);
            expect(spawnSync('git', ['-C', legacy, 'remote', 'set-url', '--push', 'web', 'https://example.com/push.git']).status).toBe(0);
            const target = getSyncDir();
            captureConsole(() => {
                expect(migrateLegacySyncDir()).toEqual({ kind: 'migrated', from: legacy, to: target });
            });
            // 相対パスは旧dir基準の絶対パスへ書き換わり、移行後も到達できる
            const got = spawnSync('git', ['-C', target, 'remote', 'get-url', 'origin'], { encoding: 'utf-8' });
            expect(got.stdout.trim()).toBe(remotePath);
            expect(spawnSync('git', ['-C', target, 'ls-remote', 'origin']).status).toBe(0);
            // 絶対パス・URLはそのまま
            const gotAbs = spawnSync('git', ['-C', target, 'remote', 'get-url', 'abs'], { encoding: 'utf-8' });
            expect(gotAbs.stdout.trim()).toBe(remotePath);
            const gotWeb = spawnSync('git', ['-C', target, 'remote', 'get-url', 'web'], { encoding: 'utf-8' });
            expect(gotWeb.stdout.trim()).toBe('https://example.com/x.git');
            // 相対パスの明示pushurlは絶対パスへ書き換わり、fetch URL（絶対パス）はそのまま。
            // raw値のassertにはconfig --getを使う（get-urlはinsteadOf展開値を返すため）
            const pushyPush = spawnSync('git', ['-C', target, 'config', '--get', 'remote.pushy.pushurl'], { encoding: 'utf-8' });
            expect(pushyPush.stdout.trim()).toBe(remotePath);
            const pushyFetch = spawnSync('git', ['-C', target, 'config', '--get', 'remote.pushy.url'], { encoding: 'utf-8' });
            expect(pushyFetch.stdout.trim()).toBe(remotePath);
            // 非相対のpushurlは書き換え対象外
            const webPush = spawnSync('git', ['-C', target, 'config', '--get', 'remote.web.pushurl'], { encoding: 'utf-8' });
            expect(webPush.stdout.trim()).toBe('https://example.com/push.git');
        } finally {
            rmSync(remotePath, { recursive: true, force: true });
        }
    });

    it('insteadOfのエイリアスは相対パスに見えても書き換えない [covers:syncdir-migration.insteadof-alias]', () => {
        const legacy = createLegacyFiles({ 'config.json': '{"defaultAuto":false}' });
        expect(spawnSync('git', ['init', legacy]).status).toBe(0);
        const remotePath = join(dirname(legacy), 'remote.git');
        expect(spawnSync('git', ['init', '--bare', remotePath]).status).toBe(0);
        // originは gh/ エイリアスで、insteadOfが実在パスへ展開する（場所に依存しない）
        expect(spawnSync('git', ['-C', legacy, 'remote', 'add', 'origin', 'gh/remote.git']).status).toBe(0);
        expect(spawnSync('git', ['-C', legacy, 'config', `url.${dirname(legacy)}/.insteadOf`, 'gh/']).status).toBe(0);
        try {
            expect(spawnSync('git', ['-C', legacy, 'ls-remote', 'origin']).status).toBe(0);
            const target = getSyncDir();
            captureConsole(() => {
                expect(migrateLegacySyncDir()).toEqual({ kind: 'migrated', from: legacy, to: target });
            });
            // raw URLは書き換わらず、移行後もinsteadOf経由で到達できる
            const got = spawnSync('git', ['-C', target, 'remote', 'get-url', 'origin'], { encoding: 'utf-8' });
            expect(got.stdout.trim()).toBe(remotePath);
            const raw = spawnSync('git', ['-C', target, 'config', '--get', 'remote.origin.url'], { encoding: 'utf-8' });
            expect(raw.stdout.trim()).toBe('gh/remote.git');
            expect(spawnSync('git', ['-C', target, 'ls-remote', 'origin']).status).toBe(0);
        } finally {
            rmSync(remotePath, { recursive: true, force: true });
        }
    });

    it('移行済みの状態での再実行は何もしない（二重移行の防止） [covers:syncdir-migration.idempotent]', () => {
        createLegacyFiles({ 'config.json': '{"defaultAuto":false}' });
        const target = getSyncDir();
        captureConsole(() => migrateLegacySyncDir());
        const markerAfterFirst = readFileSync(getMigrationMarkerPath(), 'utf-8');

        const second = captureConsole(() => {
            expect(migrateLegacySyncDir()).toEqual({ kind: 'not-needed', reason: 'legacy-absent' });
        });
        expect(second.logs.some(l => l.includes('Migrated sync data directory'))).toBe(false);
        // データ・markerともに不変
        expect(readFileSync(getMigrationMarkerPath(), 'utf-8')).toBe(markerAfterFirst);
        expect(existsSync(join(target, 'config.json'))).toBe(true);
    });

    it('旧dirと新dirの両方にデータがある場合は移行せず警告する（上書き事故の防止） [covers:syncdir-migration.conflict-no-overwrite]', () => {
        const legacy = createLegacyFiles({ 'projects/a.json': '{"tasks":["a"]}' });
        const target = getSyncDir();
        writeFilesAt(target, { 'projects/b.json': '{"tasks":["b"]}' });

        const captured = captureConsole(() => {
            expect(migrateLegacySyncDir()).toEqual({ kind: 'conflict', from: legacy, to: target });
        });
        expect(captured.errors.some(e => e.includes('Skipped migration'))).toBe(true);
        // 両者のデータは不变（上書きも混入も起きない）
        expect(readFileSync(join(legacy, 'projects', 'a.json'), 'utf-8')).toBe('{"tasks":["a"]}');
        expect(readFileSync(join(target, 'projects', 'b.json'), 'utf-8')).toBe('{"tasks":["b"]}');
        expect(existsSync(join(target, 'projects', 'a.json'))).toBe(false);
        expect(existsSync(join(legacy, 'projects', 'b.json'))).toBe(false);
    });

    it('新dirが空ディレクトリの場合は除去してから移行する [covers:syncdir-migration.empty-target-cleared]', () => {
        const legacy = createLegacyFiles({ 'config.json': '{"defaultAuto":true}' });
        const target = getSyncDir();
        mkdirSync(target, { recursive: true });

        captureConsole(() => {
            expect(migrateLegacySyncDir()).toEqual({ kind: 'migrated', from: legacy, to: target });
        });
        expect(existsSync(legacy)).toBe(false);
        expect(readFileSync(join(target, 'config.json'), 'utf-8')).toBe('{"defaultAuto":true}');
    });

    it('旧dirにtmのデータが無い場合は静かに無視し、新dirのデータを優先する [covers:syncdir-migration.legacy-no-data-quiet]', () => {
        const legacy = createLegacyFiles({ 'notes.txt': 'not tm data' });
        const target = getSyncDir();
        writeFilesAt(target, { 'config.json': '{"defaultAuto":false}' });

        const captured = captureConsole(() => {
            expect(migrateLegacySyncDir()).toEqual({ kind: 'not-needed', reason: 'legacy-no-data' });
        });
        expect(captured.errors).toEqual([]);
        // 旧dirは触られない
        expect(readFileSync(join(legacy, 'notes.txt'), 'utf-8')).toBe('not tm data');
        expect(readFileSync(join(target, 'config.json'), 'utf-8')).toBe('{"defaultAuto":false}');
    });

    it.skipIf(process.platform !== 'linux')(
        '新dirが旧dirと同一パスに解決される場合は何もしない [covers:syncdir-migration.same-path]',
        () => {
            // XDG_DATA_HOME=~/.local とすると data path == 旧パス
            process.env.XDG_DATA_HOME = join(homedir(), '.local');
            const legacy = createLegacyFiles({ 'config.json': '{}' });

            const captured = captureConsole(() => {
                expect(migrateLegacySyncDir()).toEqual({ kind: 'not-needed', reason: 'same-path' });
            });
            expect(captured.logs).toEqual([]);
            expect(readFileSync(join(legacy, 'config.json'), 'utf-8')).toBe('{}');
        }
    );

    it('copyDirThenRemoveはEXDEV fallbackとしてnested構成をcopyして旧dirを消す [covers:syncdir-migration.copy-fallback]', () => {
        const src = mkdtempSync(join(TMP_ROOT, 'move-src-'));
        writeFilesAt(src, { 'config.json': '{}', 'projects/deep/nested.json': '{"tasks":[]}' });
        const dst = join(TMP_ROOT, `move-dst-${randomUUID().slice(0, 8)}`);

        copyDirThenRemove(src, dst);
        expect(readFileSync(join(dst, 'config.json'), 'utf-8')).toBe('{}');
        expect(readFileSync(join(dst, 'projects', 'deep', 'nested.json'), 'utf-8')).toBe('{"tasks":[]}');
        expect(existsSync(src)).toBe(false);
    });

    // WindowsはsymlinkSyncに特権（Developer Mode/管理者）が必要なためskip
    it.skipIf(process.platform === 'win32')(
        'copyDirThenRemoveは相対symlinkのリンクテキストを保持し、旧dir削除後も実体を指し続ける [covers:syncdir-migration.copy-fallback-symlink]',
        () => {
            const src = mkdtempSync(join(TMP_ROOT, 'move-symlink-src-'));
            writeFilesAt(src, { 'projects/real.json': '{"tasks":[]}' });
            symlinkSync('real.json', join(src, 'projects', 'alias.json'));
            const dst = join(TMP_ROOT, `move-symlink-dst-${randomUUID().slice(0, 8)}`);

            copyDirThenRemove(src, dst);
            // リンクテキストが相対のまま保持される（旧dir内の絶対パスへ書き換わらない）
            expect(readlinkSync(join(dst, 'projects', 'alias.json'))).toBe('real.json');
            // 旧dir削除後もリンクは実体を指し続ける（danglingにならない）
            expect(existsSync(src)).toBe(false);
            expect(readFileSync(join(dst, 'projects', 'alias.json'), 'utf-8')).toBe('{"tasks":[]}');
        }
    );
});

// --- 移行の発火地点 ---

describe('旧同期ディレクトリ移行の発火地点', () => {
    it('tm syncコマンドの入口で移行が走る [covers:syncdir-migration.sync-command-hook]', () => {
        const legacy = createLegacyFiles({ 'config.json': '{"defaultAuto":false}' });
        const target = getSyncDir();

        captureConsole(() => syncCommand(['status']));
        expect(existsSync(legacy)).toBe(false);
        expect(existsSync(join(target, 'config.json'))).toBe(true);
    });

    it('tm gitコマンドの入口で移行が走る [covers:syncdir-migration.git-command-hook]', () => {
        const legacy = createLegacyFiles({ 'config.json': '{}' });
        expect(spawnSync('git', ['init', legacy]).status).toBe(0);
        const target = getSyncDir();

        const captured = captureConsole(() => gitCommand([]));
        expect(existsSync(legacy)).toBe(false);
        expect(spawnSync('git', ['-C', target, 'rev-parse', '--git-dir']).status).toBe(0);
        expect(captured.logs.some(l => l.includes('Git repository at'))).toBe(true);
    });

    it('自動同期（tryAutoSync）の入口で移行が走り、以後の保存は新dirへ行われる [covers:syncdir-migration.auto-sync-hook]', () => {
        const legacy = createLegacyFiles({ 'projects/shared.json': '{"tasks":[]}', 'config.json': '{}' });
        expect(spawnSync('git', ['init', legacy]).status).toBe(0);
        const target = getSyncDir();
        const store: TaskStore = { sync: { id: 'shared', enabled: true, auto: true }, tasks: [] };

        captureConsole(() => tryAutoSync(store.sync, store));
        expect(existsSync(legacy)).toBe(false);
        expect(spawnSync('git', ['-C', target, 'rev-parse', '--git-dir']).status).toBe(0);
        // 移行後にsaveToSyncが走り、storeの内容が新dirへ書かれている
        expect(readFileSync(join(target, 'projects', 'shared.json'), 'utf-8')).toBe(JSON.stringify(store, null, 2));
    });
});
