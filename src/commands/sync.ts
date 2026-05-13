import { loadSyncConfig, saveSyncConfig, loadStore, saveStore, getNextId } from '../store';
import {
    initSyncRepo,
    isSyncInitialized,
    saveToSync,
    pullFromSync,
    listSyncedProjects,
    generateSyncId,
    getSyncDir,
    runGitCommand,
} from '../syncStore';
import { spawnSync } from 'child_process';
import type { SyncConfig, Task } from '../types';

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
        const store = loadStore();
        if (saveToSync(syncId, store)) {
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

function handleSave(): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    const store = loadStore();
    if (saveToSync(syncConfig.id, store)) {
        console.log(`Saved to sync directory. (id: ${syncConfig.id})`);
    } else {
        process.exit(1);
    }
}

function handlePush(): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    // save
    const store = loadStore();
    if (!saveToSync(syncConfig.id, store)) {
        process.exit(1);
    }
    console.log(`Saved. (id: ${syncConfig.id})`);

    // git add
    runGitCommand(['add', '.']);

    // git commit
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultMessage = `sync: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const commitResult = spawnSync('git', ['commit', '-m', defaultMessage], {
        cwd: getSyncDir(),
        encoding: 'utf-8',
        stdio: 'pipe',
    });
    if (commitResult.status !== 0) {
        if (commitResult.stdout?.includes('nothing to commit')) {
            console.log('Nothing to commit.');
        } else {
            console.error('Failed to commit.');
            console.error(commitResult.stderr);
            process.exit(1);
        }
    } else {
        console.log(`Committed: ${defaultMessage}`);
    }

    // git push
    const pushStatus = runGitCommand(['push', '--set-upstream', 'origin', 'HEAD']);
    if (pushStatus !== 0) {
        console.error('Failed to push.');
        process.exit(1);
    }
}

function handlePull(options: Record<string, string | boolean>): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    // リモートの変更を取得
    const pullStatus = runGitCommand(['pull', '--rebase']);
    if (pullStatus !== 0) {
        console.error('Warning: git pull failed. Using local data.');
    }

    const remoteStore = pullFromSync(syncConfig.id);
    if (!remoteStore) {
        process.exit(1);
    }

    const currentStore = loadStore();
    const merge = options.merge === true;

    if (merge) {
        // マージモード: 両方のタスクを統合（IDが重複する場合は作成日時を確認して衝突を解決）
        const mergedTasks = [...currentStore.tasks];
        let idCollisions = 0;
        let conflictsResolved = 0;

        for (const remoteTask of remoteStore.tasks) {
            const sameTaskIndex = mergedTasks.findIndex(
                t => t.id === remoteTask.id && t.created_at === remoteTask.created_at
            );

            if (sameTaskIndex >= 0) {
                const existing = mergedTasks[sameTaskIndex];
                if (existing && new Date(remoteTask.updated_at) > new Date(existing.updated_at)) {
                    mergedTasks[sameTaskIndex] = remoteTask;
                    conflictsResolved++;
                }
            } else {
                const hasIdCollision = mergedTasks.some(t => t.id === remoteTask.id);
                if (hasIdCollision) {
                    const newId = getNextId(mergedTasks);
                    mergedTasks.push({ ...remoteTask, id: newId });
                    idCollisions++;
                } else {
                    mergedTasks.push(remoteTask);
                }
            }
        }
        currentStore.tasks = mergedTasks;
        saveStore(currentStore);
        let msg = `Merged from sync repository. (${remoteStore.tasks.length} tasks)`;
        if (idCollisions > 0) msg += ` ID collisions resolved: ${idCollisions}.`;
        if (conflictsResolved > 0) msg += ` Conflicts resolved: ${conflictsResolved}.`;
        console.log(msg);
    } else {
        // 上書きモード
        currentStore.tasks = remoteStore.tasks;
        saveStore(currentStore);
        console.log(`Pulled from sync repository. (${remoteStore.tasks.length} tasks)`);
    }
}

function handleSet(positional: string[]): void {
    const mode = positional[0];
    if (mode !== 'auto' && mode !== 'manual') {
        console.error('Usage: tm sync set <auto|manual>');
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

    if (syncConfig) {
        console.log('=== Current Project ===');
        console.log(`ID: ${syncConfig.id}`);
        console.log(`Enabled: ${syncConfig.enabled ? 'Yes' : 'No'}`);
        console.log(`Auto: ${syncConfig.auto ? 'Yes' : 'No'}`);
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
  push                    Push sync directory to remote
  pull [--merge]          Pull tasks from sync repository
  set <auto|manual>       Set sync mode
  status                  Show sync status
  list                    List synced projects

Examples:
  tm sync add --id my-project --save
  tm sync save
  tm sync push
  tm sync pull --merge
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
        case 'push':
            handlePush();
            break;
        case 'pull':
            handlePull(options);
            break;
        case 'set':
            handleSet(positional);
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
