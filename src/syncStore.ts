import { join, basename, dirname, resolve, sep } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync } from 'fs';
import { spawnSync } from 'child_process';
import type { TaskStore, SyncConfig } from './types';

export interface SyncGlobalConfig {
    defaultAuto: boolean;
}

export function getSyncDir(): string {
    return join(homedir(), '.local', 'task-memory');
}

export function getProjectsDir(): string {
    return join(getSyncDir(), 'projects');
}

function getConfigFile(): string {
    return join(getSyncDir(), 'config.json');
}

export type SyncDirState = 'initialized' | 'not-git' | 'absent';

export function getSyncDirState(): SyncDirState {
    const syncDir = getSyncDir();
    if (!existsSync(syncDir)) return 'absent';
    if (!existsSync(join(syncDir, '.git'))) return 'not-git';
    return 'initialized';
}

export function isSyncInitialized(): boolean {
    return getSyncDirState() === 'initialized';
}

export function initSyncRepo(): boolean {
    const syncDir = getSyncDir();
    const projectsDir = getProjectsDir();
    if (!existsSync(syncDir)) {
        mkdirSync(syncDir, { recursive: true });
    }
    if (!existsSync(projectsDir)) {
        mkdirSync(projectsDir, { recursive: true });
    }

    // git init
    if (!existsSync(join(syncDir, '.git'))) {
        const result = spawnSync('git', ['init'], { cwd: syncDir, stdio: 'inherit' });
        if (result.status !== 0) {
            console.error('Failed to initialize git repository');
            return false;
        }
    }

    // config.json を作成
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
        const config: SyncGlobalConfig = { defaultAuto: false };
        writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    }

    // .gitignore を作成（必要に応じて）
    const gitignorePath = join(syncDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '# Add patterns to ignore\n', 'utf-8');
    }

    return true;
}

export function loadGlobalConfig(): SyncGlobalConfig {
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
        return { defaultAuto: false };
    }
    try {
        const data = readFileSync(configFile, 'utf-8');
        return JSON.parse(data) as SyncGlobalConfig;
    } catch (e) {
        return { defaultAuto: false };
    }
}

export function saveGlobalConfig(config: SyncGlobalConfig): void {
    writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getProjectFilePath(syncId: string): string {
    return join(getProjectsDir(), `${syncId}.json`);
}

export function isValidSyncId(id: string): boolean {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;
    if (id === '.' || id === '..') return false;
    const resolved = resolve(getProjectFilePath(id));
    const projectsDir = resolve(getProjectsDir()) + sep;
    return resolved.startsWith(projectsDir);
}

export function isSafeGitUrl(url: string): boolean {
    // '::'はgitのremote helper構文（例: ext::sh -c '...'）を起動し、任意コマンド実行を許す。
    // isSafeGitUrl()はオプション注入対策専用ではなく、危険なurl文字列を拒否する境界のため
    // ここで合わせて拒否する（コードレビュー指摘対応）。
    return url.length > 0 && !url.startsWith('-') && !url.includes('::');
}

export function ensureProjectsDir(): void {
    mkdirSync(getProjectsDir(), { recursive: true });
}

export function cloneSyncRepo(url: string): number {
    const syncDir = getSyncDir();
    mkdirSync(dirname(syncDir), { recursive: true });
    const result = spawnSync('git', ['clone', '--', url, syncDir], { stdio: 'inherit' });
    return result.status ?? 1;
}

export function saveToSync(syncId: string, store: TaskStore): boolean {
    if (!isValidSyncId(syncId)) {
        console.error(`Invalid sync id: ${syncId}`);
        return false;
    }

    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return false;
    }

    const projectFile = getProjectFilePath(syncId);

    try {
        writeFileSync(projectFile, JSON.stringify(store, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error(`Failed to save to sync: ${e}`);
        return false;
    }
}

export function tryAutoSync(syncConfig: SyncConfig | undefined, store: TaskStore): void {
    if (!syncConfig?.enabled || !syncConfig.auto) {
        return;
    }

    if (!isSyncInitialized()) {
        return;
    }

    saveToSync(syncConfig.id, store);
}

export function pullFromSync(syncId: string): TaskStore | null {
    if (!isValidSyncId(syncId)) {
        console.error(`Invalid sync id: ${syncId}`);
        return null;
    }

    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return null;
    }

    const projectFile = getProjectFilePath(syncId);

    if (!existsSync(projectFile)) {
        console.error(`Project "${syncId}" not found in sync repository.`);
        console.error('Run "tm sync list" to see available projects.');
        console.error('Run "tm sync set --id <name>" to use a different ID for this project.');
        return null;
    }

    try {
        const data = readFileSync(projectFile, 'utf-8');
        return JSON.parse(data) as TaskStore;
    } catch (e) {
        console.error(`Failed to pull from sync: ${e}`);
        return null;
    }
}

export function hasSyncProject(syncId: string): boolean {
    if (!isValidSyncId(syncId)) return false;
    return existsSync(getProjectFilePath(syncId));
}

export function listSyncedProjects(): string[] {
    const projectsDir = getProjectsDir();
    if (!existsSync(projectsDir)) {
        return [];
    }

    const files = readdirSync(projectsDir) as string[];
    return files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace(/\.json$/, ''));
}

export function runGitCommand(args: string[], captureOutput = false): number {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return 1;
    }

    const stdio = captureOutput ? 'pipe' : 'inherit';
    const result = spawnSync('git', args, { cwd: getSyncDir(), encoding: captureOutput ? 'utf-8' : undefined, stdio });
    return result.status ?? 1;
}

export function runGitCommandCapture(args: string[]): { status: number; stdout: string; stderr: string } {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return { status: 1, stdout: '', stderr: 'Sync repository not initialized' };
    }

    const result = spawnSync('git', args, { cwd: getSyncDir(), encoding: 'utf-8', stdio: 'pipe' });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

export function getSyncRemoteUrl(): string | null {
    if (!isSyncInitialized()) return null;
    const result = runGitCommandCapture(['remote', 'get-url', 'origin']);
    if (result.status !== 0) return null;
    const url = result.stdout.trim();
    return url.length > 0 ? url : null;
}

export function hasSyncCommits(): boolean {
    if (!isSyncInitialized()) return false;
    return runGitCommandCapture(['rev-parse', '--verify', 'HEAD']).status === 0;
}

export type AdoptResult =
    | { kind: 'adopted'; branch: string }
    | { kind: 'remote-empty' }
    | { kind: 'fetch-failed'; stderr: string }
    | { kind: 'checkout-failed'; stderr: string };

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

// 前提: isSyncInitialized() && !hasSyncCommits() && getSyncRemoteUrl() !== null
// （呼び出し側でこの3条件を満たす場合のみ呼ぶ）
export function adoptRemoteIntoEmptyRepo(): AdoptResult {
    const syncDir = getSyncDir();

    const symrefResult = runGitCommandCapture(['ls-remote', '--symref', 'origin', 'HEAD']);
    if (symrefResult.status !== 0) {
        return { kind: 'fetch-failed', stderr: symrefResult.stderr };
    }
    const match = symrefResult.stdout.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m);
    const branch = match?.[1];
    if (!branch) {
        return { kind: 'remote-empty' };
    }
    // isSafeGitUrl()は「-始まり/::を含む文字列をgit引数へ渡さない」判定として汎用的に使える。
    // branchはremoteから受け取った値をfetch/checkoutへそのまま渡すため、URLと同じ境界で検証する
    // （コードレビュー指摘対応: '-'始まりのbranch名がgitオプションと誤解釈されるのを防ぐ）
    if (!isSafeGitUrl(branch)) {
        return { kind: 'fetch-failed', stderr: `Unsafe branch name from remote: "${branch}"` };
    }

    const fetchResult = runGitCommandCapture(['fetch', 'origin', branch]);
    if (fetchResult.status !== 0) {
        return { kind: 'fetch-failed', stderr: fetchResult.stderr };
    }

    // ブートストラップファイル（config.json / .gitignore）が未追跡なら退避する。
    // projects/配下は対象外: 衝突すればcheckoutが失敗し非破壊のまま通知される。
    const backedUp: string[] = [];
    for (const name of ['config.json', '.gitignore']) {
        const path = join(syncDir, name);
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

    const checkoutResult = runGitCommandCapture(['checkout', '-B', branch, `origin/${branch}`]);
    if (checkoutResult.status !== 0) {
        return { kind: 'checkout-failed', stderr: checkoutResult.stderr };
    }

    return { kind: 'adopted', branch };
}

export function generateSyncId(): string {
    const originResult = spawnSync('git', ['remote', 'get-url', 'origin'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (originResult.status === 0 && originResult.stdout) {
        const url = originResult.stdout.trim();
        // Extract "owner/repo" from HTTPS or SSH remote URLs
        const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (match?.[1]) return match[1].replace('/', '-');
    }

    const toplevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (toplevelResult.status === 0 && toplevelResult.stdout) {
        return basename(toplevelResult.stdout.trim()) || 'unknown';
    }

    return basename(process.cwd()) || 'unknown';
}
