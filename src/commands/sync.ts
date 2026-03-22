import { loadSyncConfig, saveSyncConfig, loadStore, saveStore, getNextId } from '../store';
import {
    initSyncRepo,
    isSyncInitialized,
    pushToSync,
    pullFromSync,
    listSyncedProjects,
    generateSyncId,
    getSyncDir,
    generateAgeKey,
    getPublicKeyFromIdentityFile,
    loadGlobalConfig,
    saveGlobalConfig,
    runGitCommand,
} from '../syncStore';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import type { SyncConfig, Task } from '../types';

export interface MergeResult {
    tasks: Task[];
    idCollisions: number;
    conflictsResolved: number;
}

/**
 * id+created_at の複合キーで同一性を判定してリモートタスクをローカルにマージする。
 *
 * - 同じ id & created_at → 同一タスク: updated_at が新しい方を採用
 * - 同じ id & 異なる created_at → ID衝突: リモートタスクに新IDを割り当てて追加
 * - id が存在しない → 新規タスク: そのまま追加
 */
export function mergeTasks(localTasks: Task[], remoteTasks: Task[]): MergeResult {
    const merged = [...localTasks];
    let idCollisions = 0;
    let conflictsResolved = 0;

    for (const remoteTask of remoteTasks) {
        const sameTaskIndex = merged.findIndex(
            t => t.id === remoteTask.id && t.created_at === remoteTask.created_at
        );

        if (sameTaskIndex >= 0) {
            const existing = merged[sameTaskIndex];
            if (existing && new Date(remoteTask.updated_at) > new Date(existing.updated_at)) {
                merged[sameTaskIndex] = remoteTask;
                conflictsResolved++;
            }
        } else {
            const hasIdCollision = merged.some(t => t.id === remoteTask.id);
            if (hasIdCollision) {
                const newId = getNextId(merged);
                merged.push({ ...remoteTask, id: newId });
                idCollisions++;
            } else {
                merged.push(remoteTask);
            }
        }
    }

    return { tasks: merged, idCollisions, conflictsResolved };
}

function parseArgs(args: string[]): { subcommand: string; options: Record<string, string | boolean>; positional: string[] } {
    const subcommand = args[0] || '';
    const options: Record<string, string | boolean> = {};
    const positional: string[] = [];

    let i = 1;
    while (i < args.length) {
        const arg = args[i];
        if (arg?.startsWith('--')) {
            const key = arg.slice(2);
            const nextArg = args[i + 1];
            if (nextArg && !nextArg.startsWith('--')) {
                options[key] = nextArg;
                i += 2;
            } else {
                options[key] = true;
                i++;
            }
        } else {
            positional.push(arg);
            i++;
        }
    }

    return { subcommand, options, positional };
}

function ensureInitialized(): boolean {
    if (isSyncInitialized()) {
        return true;
    }
    return initSyncRepo();
}

function handleAdd(options: Record<string, string | boolean>): void {
    if (!ensureInitialized()) {
        console.error('Failed to initialize sync repository');
        process.exit(1);
    }

    const existingConfig = loadSyncConfig();
    if (existingConfig?.enabled) {
        console.log(`Already added to sync with id: ${existingConfig.id}`);
        return;
    }

    const syncId = (typeof options.id === 'string' ? options.id : null) || generateSyncId();
    const syncConfig: SyncConfig = {
        id: syncId,
        enabled: true,
        auto: false,
    };

    saveSyncConfig(syncConfig);
    console.log(`Added to sync with id: ${syncId}`);

    // --save オプションがある場合は即座にsave
    if (options.save) {
        const globalConfig = loadGlobalConfig();
        const { recipient } = resolveEncryptSettings(syncConfig, globalConfig);
        const store = loadStore();
        if (pushToSync(syncId, store, recipient)) {
            console.log('Saved to sync directory.');
        }
    }
}

function handleRemove(): void {
    const existingConfig = loadSyncConfig();
    if (!existingConfig?.enabled) {
        console.log('Not currently synced.');
        return;
    }

    const syncConfig: SyncConfig = {
        ...existingConfig,
        enabled: false,
    };

    saveSyncConfig(syncConfig);
    console.log(`Removed from sync. (id was: ${existingConfig.id})`);
}

export function resolveEncryptSettings(
    syncConfig: SyncConfig,
    globalConfig: { defaultEncryptEnabled?: boolean; defaultEncryptRecipient?: string; defaultEncryptIdentityFile?: string }
): { enabled: boolean; recipient: string | undefined; identityFile: string | undefined } {
    const enabled = syncConfig.encryptEnabled ?? globalConfig.defaultEncryptEnabled ?? false;
    if (!enabled) return { enabled: false, recipient: undefined, identityFile: undefined };
    return {
        enabled: true,
        recipient: syncConfig.encryptRecipient ?? globalConfig.defaultEncryptRecipient,
        identityFile: syncConfig.encryptIdentityFile ?? globalConfig.defaultEncryptIdentityFile,
    };
}

function handleSave(): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    const globalConfig = loadGlobalConfig();
    const { recipient } = resolveEncryptSettings(syncConfig, globalConfig);
    const store = loadStore();
    if (pushToSync(syncConfig.id, store, recipient)) {
        console.log(`Saved to sync directory. (id: ${syncConfig.id})`);
    } else {
        process.exit(1);
    }
}

function handleLoad(options: Record<string, string | boolean>): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    const globalConfig = loadGlobalConfig();
    const { identityFile } = resolveEncryptSettings(syncConfig, globalConfig);
    const remoteStore = pullFromSync(syncConfig.id, identityFile);
    if (!remoteStore) {
        process.exit(1);
    }

    const currentStore = loadStore();
    const merge = options.merge === true;

    if (merge) {
        const result = mergeTasks(currentStore.tasks, remoteStore.tasks);
        currentStore.tasks = result.tasks;
        saveStore(currentStore);
        let msg = `Merged from sync directory. (${remoteStore.tasks.length} tasks)`;
        if (result.idCollisions > 0) msg += ` ID collisions resolved: ${result.idCollisions}.`;
        if (result.conflictsResolved > 0) msg += ` Conflicts resolved: ${result.conflictsResolved}.`;
        console.log(msg);
    } else {
        currentStore.tasks = remoteStore.tasks;
        saveStore(currentStore);
        console.log(`Loaded from sync directory. (${remoteStore.tasks.length} tasks)`);
    }
}

function handleSetKey(positional: string[], options: Record<string, string | boolean>): void {
    const isGlobal = options.global === true;
    const isGenerate = options.generate === true;
    const pathArg = positional[1] ?? null;

    if (!isGenerate && !pathArg) {
        console.error('Usage: tm sync set key <path> [--global]');
        console.error('       tm sync set key --generate [--global]');
        process.exit(1);
    }

    let identityFile: string;

    if (isGenerate) {
        identityFile = join(getSyncDir(), 'age.key');
        if (!existsSync(identityFile)) {
            if (!generateAgeKey(identityFile)) {
                console.error('Failed to generate age key.');
                process.exit(1);
            }
            console.log(`Generated key file: ${identityFile}`);
        } else {
            console.log(`Using existing key file: ${identityFile}`);
        }
    } else {
        identityFile = pathArg as string;
        if (!existsSync(identityFile)) {
            console.error(`Key file not found: ${identityFile}`);
            process.exit(1);
        }
    }

    // identityファイルから公開鍵を自動抽出してrecipientに設定
    const pubkey = getPublicKeyFromIdentityFile(identityFile);
    if (!pubkey) {
        console.error(`Could not extract public key from: ${identityFile}`);
        process.exit(1);
    }

    if (isGlobal) {
        const globalConfig = loadGlobalConfig();
        globalConfig.defaultEncryptIdentityFile = identityFile;
        globalConfig.defaultEncryptRecipient = pubkey;
        saveGlobalConfig(globalConfig);
        console.log(`Global key file set: ${identityFile}`);
        console.log(`Global recipient set to: ${pubkey}`);
    } else {
        const syncConfig = loadSyncConfig();
        if (!syncConfig?.enabled) {
            console.error('Not synced. Run "tm sync add" first.');
            process.exit(1);
        }
        syncConfig.encryptIdentityFile = identityFile;
        syncConfig.encryptRecipient = pubkey;
        saveSyncConfig(syncConfig);
        console.log(`Key file set: ${identityFile}`);
        console.log(`Recipient set to: ${pubkey}`);
    }
}

function handleSetEncrypt(positional: string[], options: Record<string, string | boolean>): void {
    const isGlobal = options.global === true;
    const value = positional[1];
    if (value !== 'on' && value !== 'off') {
        console.error('Usage: tm sync set encrypt <on|off> [--global]');
        process.exit(1);
    }
    const enabled = value === 'on';

    if (isGlobal) {
        const globalConfig = loadGlobalConfig();
        globalConfig.defaultEncryptEnabled = enabled;
        saveGlobalConfig(globalConfig);
        console.log(`Global encryption ${enabled ? 'enabled' : 'disabled'}.`);
    } else {
        const syncConfig = loadSyncConfig();
        if (!syncConfig?.enabled) {
            console.error('Not synced. Run "tm sync add" first.');
            process.exit(1);
        }
        syncConfig.encryptEnabled = enabled;
        saveSyncConfig(syncConfig);
        console.log(`Encryption ${enabled ? 'enabled' : 'disabled'}.`);
    }
}

function handleSet(positional: string[], options: Record<string, string | boolean>): void {
    const mode = positional[0];

    if (mode === 'key') {
        handleSetKey(positional, options);
        return;
    }

    if (mode === 'encrypt') {
        handleSetEncrypt(positional, options);
        return;
    }

    if (mode !== 'auto' && mode !== 'manual') {
        console.error('Usage: tm sync set <auto|manual|encrypt|key>');
        process.exit(1);
    }

    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    syncConfig.auto = mode === 'auto';
    saveSyncConfig(syncConfig);
    console.log(`Sync mode set to: ${mode}`);
}

function handleStatus(): void {
    const syncConfig = loadSyncConfig();

    console.log('=== Sync Status ===');
    console.log(`Sync Directory: ${getSyncDir()}`);
    console.log(`Initialized: ${isSyncInitialized() ? 'Yes' : 'No'}`);
    console.log('');

    const globalConfig = loadGlobalConfig();
    if (globalConfig.defaultEncryptEnabled !== undefined || globalConfig.defaultEncryptIdentityFile || globalConfig.defaultEncryptRecipient) {
        console.log('=== Global Defaults ===');
        if (globalConfig.defaultEncryptEnabled !== undefined) {
            console.log(`Encrypt: ${globalConfig.defaultEncryptEnabled ? 'on' : 'off'}`);
        }
        if (globalConfig.defaultEncryptIdentityFile) {
            console.log(`Key: ${globalConfig.defaultEncryptIdentityFile}`);
        }
        if (globalConfig.defaultEncryptRecipient) {
            console.log(`Recipient: ${globalConfig.defaultEncryptRecipient}`);
        }
        console.log('');
    }

    if (syncConfig) {
        console.log('=== Current Project ===');
        console.log(`ID: ${syncConfig.id}`);
        console.log(`Enabled: ${syncConfig.enabled ? 'Yes' : 'No'}`);
        console.log(`Auto: ${syncConfig.auto ? 'Yes' : 'No'}`);
        const { enabled: encryptEnabled, identityFile: identity, recipient } = resolveEncryptSettings(syncConfig, globalConfig);
        console.log(`Encrypt: ${encryptEnabled ? 'on' : 'off'}${syncConfig.encryptEnabled === undefined ? ' (global)' : ''}`);
        if (encryptEnabled) {
            if (identity) console.log(`Key: ${identity}${syncConfig.encryptIdentityFile === undefined ? ' (global)' : ''}`);
            if (recipient) console.log(`Recipient: ${recipient}${syncConfig.encryptRecipient === undefined ? ' (global)' : ''}`);
        }
    } else {
        console.log('Current project is not synced.');
    }
    console.log('');

    const projects = listSyncedProjects();
    if (projects.length > 0) {
        console.log('=== Synced Projects ===');
        for (const p of projects) {
            console.log(`  - ${p}`);
        }
    }
}

function checkGhAuth(): void {
    const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });
    if (ghCheck.error || ghCheck.status !== 0) {
        console.error('gh command is not available or not authenticated. Run "gh auth login" first.');
        process.exit(1);
    }
}


function handleUpload(options: Record<string, string | boolean>): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    // save
    const globalConfig = loadGlobalConfig();
    const { recipient } = resolveEncryptSettings(syncConfig, globalConfig);
    const store = loadStore();
    if (!pushToSync(syncConfig.id, store, recipient)) {
        process.exit(1);
    }
    console.log(`Saved. (id: ${syncConfig.id})`);

    // git add
    runGitCommand(['add', '.']);

    // git commit
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultMessage = `sync: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const message = typeof options.message === 'string' ? options.message : defaultMessage;

    const commitResult = spawnSync('git', ['commit', '-m', message], {
        cwd: getSyncDir(),
        encoding: 'utf-8',
        stdio: 'pipe',
    });
    if (commitResult.status !== 0) {
        if (commitResult.stdout.includes('nothing to commit')) {
            console.log('Nothing to commit.');
        } else {
            console.error('Failed to commit.');
            console.error(commitResult.stderr);
            process.exit(1);
        }
    } else {
        console.log(`Committed: ${message}`);
    }

    // git push（初回はupstreamを設定）
    const pushResult = spawnSync('git', ['push', '--set-upstream', 'origin', 'HEAD'], {
        cwd: getSyncDir(),
        stdio: 'inherit',
    });
    if (pushResult.status !== 0) {
        console.error('Failed to push.');
        process.exit(1);
    }
}

function handleRepoCreate(options: Record<string, string | boolean>): void {
    checkGhAuth();

    if (!ensureInitialized()) {
        console.error('Failed to initialize sync repository');
        process.exit(1);
    }

    const isPublic = options.public === true;
    const repoName = typeof options.name === 'string' ? options.name : 'sync-task-memory';
    const visibility = isPublic ? '--public' : '--private';

    console.log(`Creating ${isPublic ? 'public' : 'private'} repository: ${repoName}`);

    const createResult = spawnSync('gh', ['repo', 'create', repoName, visibility], {
        encoding: 'utf-8',
        stdio: 'pipe',
    });

    if (createResult.status !== 0) {
        console.error('Failed to create repository.');
        console.error(createResult.stderr);
        process.exit(1);
    }

    const repoUrl = createResult.stdout.trim();
    console.log(`Repository created: ${repoUrl}`);

    // remoteを設定
    spawnSync('git', ['remote', 'remove', 'origin'], { cwd: getSyncDir(), encoding: 'utf-8' });
    spawnSync('git', ['remote', 'add', 'origin', repoUrl], { cwd: getSyncDir(), stdio: 'inherit' });
    console.log(`Remote set. Use "tm git push" to push your data.`);
}

function handleRepoSet(positional: string[]): void {
    const url = positional[1];
    if (!url) {
        console.error('Usage: tm sync repo set <url>');
        process.exit(1);
    }

    if (!ensureInitialized()) {
        console.error('Failed to initialize sync repository');
        process.exit(1);
    }

    // 既存のoriginを削除してから追加
    spawnSync('git', ['remote', 'remove', 'origin'], { cwd: getSyncDir(), encoding: 'utf-8' });
    const addResult = spawnSync('git', ['remote', 'add', 'origin', url], {
        cwd: getSyncDir(),
        stdio: 'inherit',
    });
    if (addResult.status !== 0) {
        console.error('Failed to set remote.');
        process.exit(1);
    }
    console.log(`Remote set: ${url}`);
}

function handleRepoShow(): void {
    const result = spawnSync('git', ['remote', '-v'], {
        cwd: getSyncDir(),
        encoding: 'utf-8',
    });
    if (result.status !== 0 || !result.stdout.trim()) {
        console.log('No remote configured. Use "tm sync repo create" or "tm sync repo set <url>".');
        return;
    }
    console.log(result.stdout.trim());
}

function handleRepo(positional: string[], options: Record<string, string | boolean>): void {
    const subcommand = positional[0];
    switch (subcommand) {
        case 'create':
            handleRepoCreate(options);
            break;
        case 'set':
            handleRepoSet(positional);
            break;
        case 'show':
            handleRepoShow();
            break;
        default:
            console.error('Usage: tm sync repo <create|set|show>');
            process.exit(1);
    }
}

function handleList(): void {
    const projects = listSyncedProjects();
    if (projects.length === 0) {
        console.log('No projects synced.');
        return;
    }

    console.log('Synced projects:');
    for (const p of projects) {
        console.log(`  - ${p}`);
    }
}

function showHelp(): void {
    console.log(`
Usage: tm sync <subcommand> [options]

Subcommands:
  add [--id <name>] [--save]
                          Add current project to sync
  remove                  Remove current project from sync
  save                    Save tasks to sync directory
  upload [--message <msg>]
                          Save, git commit, and git push
  load [--merge]          Load tasks from sync directory
  set <auto|manual>       Set sync mode
  set encrypt <on|off>    Enable/disable encryption for current project
  set encrypt <on|off> --global
                          Enable/disable encryption globally (used as fallback)
  set key <path>     Set key file (private key); recipient auto-extracted
  set key --generate Generate a new key file; recipient auto-extracted
  set key [--generate] --global
                          Apply setting globally (used as fallback)
  repo create [--name <name>] [--public]
                          Create GitHub repository and set as remote (requires gh)
                          Default name: sync-task-memory
  repo set <url>          Set existing repository as remote
  repo show               Show current remote
  status                  Show sync status
  list                    List synced projects

Examples:
  tm sync add --id my-project --save
  tm sync set key --generate --global  # age鍵を生成しグローバルに設定
  tm sync set key ~/.age.key --global  # 既存の鍵をグローバルに設定
  tm sync set encrypt on --global           # 暗号化をグローバルでデフォルト有効化
  tm sync set encrypt off                   # 現プロジェクトだけ暗号化を無効化
  tm sync repo create                  # privateリポジトリを作成
  tm sync repo create --public         # publicリポジトリを作成
  tm sync repo create --name my-tasks  # リポジトリ名を指定
  tm sync save
  tm sync load --merge
  tm sync set auto
    `);
}

export function syncCommand(args: string[]): void {
    const { subcommand, options, positional } = parseArgs(args);

    switch (subcommand) {
        case 'add':
            handleAdd(options);
            break;
        case 'remove':
        case 'rm':
            handleRemove();
            break;
        case 'save':
            handleSave();
            break;
        case 'upload':
            handleUpload(options);
            break;
        case 'load':
            handleLoad(options);
            break;
        case 'set':
            handleSet(positional, options);
            break;
        case 'repo':
            handleRepo(positional, options);
            break;
        case 'status':
            handleStatus();
            break;
        case 'list':
        case 'ls':
            handleList();
            break;
        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;
        default:
            if (!subcommand) {
                showHelp();
            } else {
                console.error(`Unknown subcommand: ${subcommand}`);
                showHelp();
                process.exit(1);
            }
    }
}
