import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
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

export function pushToSync(syncId: string, store: TaskStore): boolean {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync init" first.');
        return false;
    }

    const projectFile = getProjectFilePath(syncId);

    try {
        writeFileSync(projectFile, JSON.stringify(store, null, 2), 'utf-8');
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

    pushToSync(syncConfig.id, store);
}

export function pullFromSync(syncId: string): TaskStore | null {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync init" first.');
        return null;
    }

    const projectFile = getProjectFilePath(syncId);

    if (!existsSync(projectFile)) {
        console.error(`Project "${syncId}" not found in sync repository.`);
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

export function listSyncedProjects(): string[] {
    if (!existsSync(PROJECTS_DIR)) {
        return [];
    }

    const { readdirSync } = require('fs');
    const files = readdirSync(PROJECTS_DIR) as string[];
    return files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace(/\.json$/, ''));
}

export function runGitCommand(args: string[]): number {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync init" first.');
        return 1;
    }

    const result = spawnSync('git', args, { cwd: SYNC_DIR, stdio: 'inherit' });
    return result.status ?? 1;
}

export function generateSyncId(): string {
    // カレントディレクトリのgitリポジトリ名を使用
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (result.status === 0 && result.stdout) {
        const repoPath = result.stdout.trim();
        const repoName = repoPath.split('/').pop() || 'unknown';
        return repoName;
    }

    // gitリポジトリでない場合はディレクトリ名を使用
    const dirName = process.cwd().split('/').pop() || 'unknown';
    return dirName;
}
