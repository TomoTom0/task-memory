import { loadSyncConfig, saveSyncConfig, loadStore, saveStore } from '../store';
import {
    initSyncRepo,
    isSyncInitialized,
    pushToSync,
    pullFromSync,
    listSyncedProjects,
    generateSyncId,
    getSyncDir,
} from '../syncStore';
import type { SyncConfig } from '../types';

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

    // --push オプションがある場合は即座にpush
    if (options.push) {
        const store = loadStore();
        if (pushToSync(syncId, store)) {
            console.log('Pushed to sync repository.');
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

function handlePush(): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    const store = loadStore();
    if (pushToSync(syncConfig.id, store)) {
        console.log(`Pushed to sync repository. (id: ${syncConfig.id})`);
    } else {
        process.exit(1);
    }
}

function handlePull(options: Record<string, string | boolean>): void {
    const syncConfig = loadSyncConfig();
    if (!syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    const remoteStore = pullFromSync(syncConfig.id);
    if (!remoteStore) {
        process.exit(1);
    }

    const currentStore = loadStore();
    const merge = options.merge === true;

    if (merge) {
        // マージモード: 両方のタスクを統合（IDが重複する場合は更新日時が新しい方を採用）
        const mergedTasks = [...currentStore.tasks];
        for (const remoteTask of remoteStore.tasks) {
            const existingIndex = mergedTasks.findIndex(t => t.id === remoteTask.id);
            if (existingIndex >= 0) {
                const existing = mergedTasks[existingIndex];
                if (existing && new Date(remoteTask.updated_at) > new Date(existing.updated_at)) {
                    mergedTasks[existingIndex] = remoteTask;
                }
            } else {
                mergedTasks.push(remoteTask);
            }
        }
        currentStore.tasks = mergedTasks;
        saveStore(currentStore);
        console.log(`Merged from sync repository. (${remoteStore.tasks.length} tasks)`);
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
  add [--id <name>] [--push]
                          Add current project to sync
  remove                  Remove current project from sync
  push                    Push tasks to sync repository
  pull [--merge]          Pull tasks from sync repository
  set <auto|manual>       Set sync mode
  status                  Show sync status
  list                    List synced projects

Examples:
  tm sync add --id my-project --push
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
