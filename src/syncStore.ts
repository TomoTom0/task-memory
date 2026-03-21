import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import type { TaskStore, SyncConfig } from './types';

// 同期リポジトリのパス
const SYNC_DIR = join(homedir(), '.local', 'task-memory');
const PROJECTS_DIR = join(SYNC_DIR, 'projects');
const CONFIG_FILE = join(SYNC_DIR, 'config.json');

export interface SyncGlobalConfig {
    defaultAuto: boolean;
}

export function getSyncDir(): string {
    return SYNC_DIR;
}

export function getProjectsDir(): string {
    return PROJECTS_DIR;
}

export function isSyncInitialized(): boolean {
    return existsSync(SYNC_DIR) && existsSync(join(SYNC_DIR, '.git'));
}

export function initSyncRepo(): boolean {
    if (!existsSync(SYNC_DIR)) {
        mkdirSync(SYNC_DIR, { recursive: true });
    }
    if (!existsSync(PROJECTS_DIR)) {
        mkdirSync(PROJECTS_DIR, { recursive: true });
    }

    // git init
    if (!existsSync(join(SYNC_DIR, '.git'))) {
        const result = spawnSync('git', ['init'], { cwd: SYNC_DIR, stdio: 'inherit' });
        if (result.status !== 0) {
            console.error('Failed to initialize git repository');
            return false;
        }
    }

    // config.json を作成
    if (!existsSync(CONFIG_FILE)) {
        const config: SyncGlobalConfig = { defaultAuto: false };
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    }

    // .gitignore を作成（必要に応じて）
    const gitignorePath = join(SYNC_DIR, '.gitignore');
    if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, '# Add patterns to ignore\n', 'utf-8');
    }

    return true;
}

export function loadGlobalConfig(): SyncGlobalConfig {
    if (!existsSync(CONFIG_FILE)) {
        return { defaultAuto: false };
    }
    try {
        const data = readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(data) as SyncGlobalConfig;
    } catch (e) {
        return { defaultAuto: false };
    }
}

export function saveGlobalConfig(config: SyncGlobalConfig): void {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getProjectFilePath(syncId: string): string {
    return join(PROJECTS_DIR, `${syncId}.json`);
}

export function getEncryptedProjectFilePath(syncId: string): string {
    return join(PROJECTS_DIR, `${syncId}.json.age`);
}

/**
 * age identity ファイルから公開鍵を取得する。
 * identity ファイルのコメント行 "# public key: age1..." から抽出する。
 */
export function getPublicKeyFromIdentityFile(keyFile: string): string | null {
    try {
        const content = readFileSync(keyFile, 'utf-8');
        const match = content.match(/^# public key: (.+)$/m);
        return match ? match[1]!.trim() : null;
    } catch {
        return null;
    }
}

/**
 * データを age で暗号化する（ASCII armor 出力）。
 * identity ファイルの公開鍵を recipient として使用する。
 */
export function encryptData(data: string, keyFile: string): string | null {
    const pubkey = getPublicKeyFromIdentityFile(keyFile);
    if (!pubkey) {
        console.error(`Could not read public key from ${keyFile}`);
        return null;
    }

    const result = spawnSync('age', ['-e', '-r', pubkey, '-a'], {
        input: data,
        encoding: 'utf-8',
    });

    if (result.status !== 0) {
        console.error(`Encryption failed: ${result.stderr}`);
        return null;
    }

    return result.stdout;
}

/**
 * age で暗号化されたデータを復号する。
 */
export function decryptData(ciphertext: string, keyFile: string): string | null {
    const result = spawnSync('age', ['-d', '-i', keyFile], {
        input: ciphertext,
        encoding: 'utf-8',
    });

    if (result.status !== 0) {
        console.error(`Decryption failed: ${result.stderr}`);
        return null;
    }

    return result.stdout;
}

/**
 * age-keygen で新しい identity ファイルを生成する。
 */
export function generateAgeKey(outputPath: string): boolean {
    const result = spawnSync('age-keygen', ['-o', outputPath], {
        encoding: 'utf-8',
    });
    return result.status === 0;
}

export function pushToSync(syncId: string, store: TaskStore, encryptKeyFile?: string): boolean {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return false;
    }

    const projectFile = encryptKeyFile
        ? getEncryptedProjectFilePath(syncId)
        : getProjectFilePath(syncId);

    try {
        const jsonData = JSON.stringify(store, null, 2);
        if (encryptKeyFile) {
            const encrypted = encryptData(jsonData, encryptKeyFile);
            if (!encrypted) return false;
            writeFileSync(projectFile, encrypted, 'utf-8');
        } else {
            writeFileSync(projectFile, jsonData, 'utf-8');
        }
        return true;
    } catch (e) {
        console.error(`Failed to push to sync: ${e}`);
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

    pushToSync(syncConfig.id, store, syncConfig.encryptKeyFile);
}

export function pullFromSync(syncId: string, encryptKeyFile?: string): TaskStore | null {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return null;
    }

    const ageFile = getEncryptedProjectFilePath(syncId);
    const jsonFile = getProjectFilePath(syncId);

    try {
        if (encryptKeyFile && existsSync(ageFile)) {
            const ciphertext = readFileSync(ageFile, 'utf-8');
            const decrypted = decryptData(ciphertext, encryptKeyFile);
            if (!decrypted) return null;
            return JSON.parse(decrypted) as TaskStore;
        }

        if (existsSync(jsonFile)) {
            const data = readFileSync(jsonFile, 'utf-8');
            return JSON.parse(data) as TaskStore;
        }

        console.error(`Project "${syncId}" not found in sync repository.`);
        return null;
    } catch (e) {
        console.error(`Failed to pull from sync: ${e}`);
        return null;
    }
}

export function listSyncedProjects(): string[] {
    if (!existsSync(PROJECTS_DIR)) {
        return [];
    }

    const files = readdirSync(PROJECTS_DIR) as string[];
    return files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace(/\.json$/, ''));
}

export function runGitCommand(args: string[]): number {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return 1;
    }

    const result = spawnSync('git', args, { cwd: SYNC_DIR, stdio: 'inherit' });
    return result.status ?? 1;
}

export function normalizeRemoteUrl(url: string): string {
    let s = url.trim();
    // プロトコル除去: https://, http://, git://
    s = s.replace(/^https?:\/\//, '');
    s = s.replace(/^git:\/\//, '');
    // user@ 除去 (例: git@github.com: → github.com:)
    s = s.replace(/^[^@]+@/, '');
    // SSH の : をスラッシュに変換 (例: github.com:user/repo → github.com/user/repo)
    s = s.replace(':', '/');
    // .git サフィックス除去
    s = s.replace(/\.git$/, '');
    // スラッシュをハイフンに変換
    s = s.replace(/\//g, '-');
    // 英数字・ハイフン・ドット以外を除去
    s = s.replace(/[^a-zA-Z0-9._-]/g, '-');
    // 先頭末尾のハイフン除去
    s = s.replace(/^-+|-+$/g, '');
    return s || 'unknown';
}

export function generateSyncId(): string {
    // remote origin のURLをプロジェクト識別子として使用（クロスマシンで一意性を保証）
    const originResult = spawnSync('git', ['remote', 'get-url', 'origin'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (originResult.status === 0 && originResult.stdout) {
        return normalizeRemoteUrl(originResult.stdout.trim());
    }

    // remote origin がない場合はリポジトリのディレクトリ名にフォールバック
    const toplevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (toplevelResult.status === 0 && toplevelResult.stdout) {
        return toplevelResult.stdout.trim().split('/').pop() || 'unknown';
    }

    return process.cwd().split('/').pop() || 'unknown';
}
