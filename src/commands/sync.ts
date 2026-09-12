import { loadSyncConfig, saveSyncConfig, loadStore, saveStore, normalizeTaskOrders, getNextId } from '../store';
import {
    initSyncRepo,
    isSyncInitialized,
    saveToSync,
    pullFromSync,
    listSyncedProjects,
    generateSyncId,
    getSyncDir,
    runGitCommand,
    runGitCommandCapture,
    getSyncDirState,
    getSyncRemoteUrl,
    isSafeGitUrl,
    isValidSyncId,
    hasSyncProject,
    hasSyncCommits,
    cloneSyncRepo,
    ensureProjectsDir,
    adoptRemoteIntoEmptyRepo,
    listTrackedPathsOutsideProjects,
    snapshotFilesOutsideProjects,
    restoreMissingFilesOutsideProjects,
    getRemoteDefaultBranch,
    getRemoteHeadBranches,
    probeRemoteUnbornDefaultBranch,
    resolveRemoteSyncBranch,
    shouldRenameLocalBranchToRemoteDefault,
} from '../syncStore';
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

// remote接続（handleAdd / handleSet共通）直後の自動adopt。既にcommitがあれば何もしない。
function applyAutoAdopt(): void {
    if (hasSyncCommits()) {
        return;
    }
    const result = adoptRemoteIntoEmptyRepo();
    switch (result.kind) {
        case 'adopted':
            console.log(`Adopted existing data from remote. (branch: ${result.branch})`);
            break;
        case 'remote-empty':
            console.log('Remote repository has no commits yet. Run "tm sync push" to publish local data.');
            break;
        case 'fetch-failed':
            console.error('Failed to fetch from remote.');
            console.error(result.stderr);
            process.exit(1);
            break;
        case 'checkout-failed':
            console.error('Local files conflict with the remote content and could not be adopted automatically.');
            console.error(result.stderr);
            console.error(`Resolve manually in ${getSyncDir()}, then run "tm sync pull".`);
            process.exit(1);
            break;
    }
}

function handleClone(positional: string[]): void {
    const url = positional[0];
    if (url === undefined) {
        console.error('Usage: tm sync clone <url>');
        process.exit(1);
    }
    if (!isSafeGitUrl(url)) {
        console.error(`Invalid remote URL: "${url}" (must not start with "-").`);
        process.exit(1);
    }

    const state = getSyncDirState();
    if (state === 'initialized') {
        console.error(`Sync repository already exists at: ${getSyncDir()}`);
        console.error('To change the remote URL, run: tm sync set --remote <url>');
        process.exit(1);
    }
    if (state === 'not-git') {
        console.error(`Directory exists but is not a git repository: ${getSyncDir()}`);
        console.error('Remove or rename it, then run "tm sync clone <url>" again.');
        process.exit(1);
    }

    const cloneStatus = cloneSyncRepo(url);
    if (cloneStatus !== 0) {
        console.error('Failed to clone sync repository.');
        process.exit(1);
    }
    ensureProjectsDir();

    // remote HEAD が実在しない branch を指す場合（ローカルと remote の git 既定 branch 名の
    // 不一致で最初の push が行われた状態）、git clone は warning を出して何も checkout
    // しない。remote 側 branch が1本だけならそれを checkout して復旧する
    // （PR#46レビュー指摘対応）
    if (!hasSyncCommits()) {
        const refsResult = runGitCommandCapture(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
        const remoteBranches = refsResult.status === 0
            ? refsResult.stdout
                .split('\n')
                .map(r => r.trim())
                .filter(r => r !== '' && r !== 'origin/HEAD')
                .map(r => r.replace(/^origin\//, ''))
            : [];
        if (remoteBranches.length === 1) {
            const branch = remoteBranches[0];
            if (branch !== undefined && isSafeGitUrl(branch)) {
                const checkoutResult = runGitCommandCapture(['checkout', '-B', branch, `origin/${branch}`]);
                if (checkoutResult.status === 0) {
                    console.log(`Checked out the remote branch "${branch}" (the remote HEAD points to a nonexistent branch).`);
                } else {
                    console.error('Warning: failed to check out the remote branch after clone.');
                    console.error(checkoutResult.stderr);
                }
            }
        }
    }

    console.log(`Cloned sync repository to: ${getSyncDir()}`);
    console.log('');
    const projects = listSyncedProjects();
    if (projects.length > 0) {
        console.log('Synced projects:');
        for (const p of projects) {
            console.log(`  - ${p}`);
        }
    } else {
        console.log('No projects found in the repository.');
    }
    console.log('');
    console.log('Next steps:');
    console.log('  tm sync add --id <name>   Register the current project');
    console.log('  tm sync pull              Pull tasks for this project');
}

function handleAdd(positional: string[], options: Record<string, string | boolean>): void {
    // --- 検証フェーズ（副作用なし） ---
    if (positional.length > 0) {
        console.error(`Unexpected argument: ${positional[0]}`);
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    const allowedKeys = new Set(['id', 'save', 'remote']);
    for (const key of Object.keys(options)) {
        if (!allowedKeys.has(key)) {
            console.error(`Unknown option: --${key}`);
            console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
            process.exit(1);
        }
    }
    if (options.id === true) {
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    if (typeof options.id === 'string' && !isValidSyncId(options.id)) {
        console.error(`Invalid sync id: "${options.id}". Use only letters, digits, ".", "_", "-".`);
        process.exit(1);
    }
    if (options.remote === true) {
        console.error('Usage: tm sync add [--id <name>] [--save] [--remote <url>]');
        process.exit(1);
    }
    if (typeof options.remote === 'string' && !isSafeGitUrl(options.remote)) {
        console.error(`Invalid remote URL: "${options.remote}" (must not start with "-").`);
        process.exit(1);
    }

    // --- 実行フェーズ ---
    if (!ensureInitialized()) {
        console.error('Failed to initialize sync repository');
        process.exit(1);
    }

    const existingConfig = loadSyncConfig();
    const alreadyAdded = existingConfig?.enabled === true;
    let syncId = existingConfig?.id ?? '';

    if (!alreadyAdded) {
        syncId = (typeof options.id === 'string' ? options.id : null) || generateSyncId();
        if (!isValidSyncId(syncId)) {
            console.error(`Auto-generated sync id "${syncId}" is invalid (derived from the directory/repo name).`);
            console.error('Run again with an explicit --id <name> (letters, digits, ".", "_", "-" only).');
            process.exit(1);
        }
        // configを先に保存する: applyAutoAdopt()がfetch-failed/checkout-failedでexitしても
        // sync登録自体は成立させ、後続の「Not synced」ガードでpull/pushが復旧不能にならないようにする
        saveSyncConfig({ id: syncId, enabled: true, auto: false });
        console.log(`Added to sync with id: ${syncId}`);
    }

    if (typeof options.remote === 'string') {
        const url = options.remote;
        const current = getSyncRemoteUrl();
        if (current === null) {
            const result = runGitCommandCapture(['remote', 'add', 'origin', url]);
            if (result.status !== 0) {
                console.error('Failed to set remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin set to: ${url}`);
            applyAutoAdopt();
        } else if (current === url) {
            console.log(`Remote origin already set to: ${url}`);
            applyAutoAdopt();
        } else {
            console.error(`Warning: remote origin is already set to: ${current}. Not overwriting.`);
            console.error('Run "tm sync set --remote <url>" to change it.');
        }
    }

    if (alreadyAdded) {
        console.log(`Already added to sync with id: ${syncId}`);
        return;
    }

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

    const remoteUrl = getSyncRemoteUrl();
    if (remoteUrl === null) {
        console.error('Remote origin is not configured.');
        console.error('Run "tm sync add --remote <url>" or "tm sync set --remote <url>" to configure it.');
        process.exit(1);
    }

    // save
    const store = loadStore();
    if (!saveToSync(syncConfig.id, store)) {
        process.exit(1);
    }
    console.log(`Saved. (id: ${syncConfig.id})`);

    // 同期対象は projects/ のみ。旧版の git add . や tm git 経由の stage で projects/ 外が
    // 追跡済みに残っている場合、そのすべて（config.json / .gitignore に限らない）を
    // index から外す。--cached のため作業ツリー上のファイルは削除されず、この解除を
    // commit に含めることで旧版で初期化された repo も次回の push で remote から排除される。
    const pathsOutsideProjects = listTrackedPathsOutsideProjects();
    if (pathsOutsideProjects.length > 0) {
        const untrackResult = runGitCommandCapture(['rm', '--cached', '--ignore-unmatch', '--', ...pathsOutsideProjects]);
        if (untrackResult.status !== 0) {
            console.error('Failed to stop tracking local sync files.');
            console.error(untrackResult.stderr);
            process.exit(1);
        }
    }

    // git add
    const addStatus = runGitCommand(['add', '--', 'projects']);
    if (addStatus !== 0) {
        console.error('Failed to stage changes.');
        process.exit(1);
    }

    // git commit
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultMessage = `sync: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const commitResult = runGitCommandCapture(['commit', '-m', defaultMessage]);
    if (commitResult.status !== 0) {
        if (commitResult.stdout.includes('nothing to commit')) {
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
    // ローカルの git 既定 branch（例: master）と remote の既定 branch（例: main）が異なる
    // 場合、そのまま push すると remote HEAD が実在しない branch を指したままとなり、
    // 他PCの clone / adopt / pull が破綻する。remote 既定 branch 名は ls-remote では
    // unborn HEAD（空remote）から取得できないため、remote が空のときだけ clone の
    // probe で広告名を取得し（PR#47レビュー指摘対応）、remote にまだ実在しない名前なら
    // 先にローカル branch をその名前へ rename してから push する
    const branchResult = runGitCommandCapture(['rev-parse', '--abbrev-ref', 'HEAD']);
    const localBranch = branchResult.status === 0 ? branchResult.stdout.trim() : '';
    if (localBranch !== '' && localBranch !== 'HEAD' && isSafeGitUrl(localBranch)) {
        const remoteHeadBranches = getRemoteHeadBranches();
        let remoteDefaultBranch = getRemoteDefaultBranch();
        if (remoteDefaultBranch === null && remoteHeadBranches !== null && remoteHeadBranches.size === 0) {
            remoteDefaultBranch = probeRemoteUnbornDefaultBranch(getSyncRemoteUrl());
        }
        const renameTo = shouldRenameLocalBranchToRemoteDefault(localBranch, remoteDefaultBranch, remoteHeadBranches);
        if (renameTo !== null) {
            const renameResult = runGitCommandCapture(['branch', '-m', localBranch, renameTo]);
            if (renameResult.status === 0) {
                console.log(`Renamed local branch "${localBranch}" to "${renameTo}" to match the remote default branch.`);
            } else {
                console.error(`Warning: failed to rename branch "${localBranch}" to "${renameTo}".`);
                console.error(renameResult.stderr);
            }
        }
    }
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

    if (!isSyncInitialized()) {
        console.error('Sync repository is not initialized on this machine.');
        console.error('If you have a remote sync repository, run: tm sync clone <url>');
        console.error('Otherwise, run: tm sync add --save to start a new one.');
        process.exit(1);
    }

    const remoteUrl = getSyncRemoteUrl();
    if (remoteUrl === null && !hasSyncProject(syncConfig.id)) {
        console.error(`No remote is configured and no local data exists for project "${syncConfig.id}".`);
        console.error('Run "tm sync set --remote <url>" to connect a remote repository, then "tm sync pull".');
        process.exit(1);
    }

    // リモートの変更を取得
    // 旧バージョンで初期化された sync repo には現在ブランチの upstream が
    // 設定されていない場合がある。origin の既定ブランチを明示すれば、その状態でも
    // pull できる（通常の clone で設定された upstream がある場合にも同じく動作する）。
    // remote HEAD が実在しない branch を指す場合（ローカルと remote の git 既定 branch
    // 名の不一致で最初の push が行われた状態）は origin HEAD が解決できず pull が失敗
    // するため、remote 側 branch が1本だけならその branch から pull する
    // （clone / adopt の同一条件による復旧と対。PR#46レビュー指摘対応）。
    // 他PCの新版 push が生成する projects/ 外ファイルの削除 commit は、このPCの
    // 追跡済みローカル設定ファイル（旧版の config.json / .gitignore 等）を作業ツリー
    // から消してしまうため、pull 前に保存し pull 後に欠損分を復元する。
    const localFileSnapshot = snapshotFilesOutsideProjects();

    const pullBranchDecision = resolveRemoteSyncBranch(getRemoteDefaultBranch(), getRemoteHeadBranches() ?? new Set());
    const pullBranch = 'branch' in pullBranchDecision && isSafeGitUrl(pullBranchDecision.branch)
        ? pullBranchDecision.branch
        : 'HEAD';

    const pullStatus = runGitCommand(['pull', '--rebase', 'origin', pullBranch]);
    if (pullStatus !== 0) {
        console.error('Warning: git pull failed. Using local data.');
    }

    const restoredPaths = restoreMissingFilesOutsideProjects(localFileSnapshot);
    if (restoredPaths.length > 0) {
        console.log(`Restored local files excluded from sync: ${restoredPaths.join(', ')}`);
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
        currentStore.tasks = normalizeTaskOrders(mergedTasks);
        saveStore(currentStore);
        let msg = `Merged from sync repository. (${remoteStore.tasks.length} tasks)`;
        if (idCollisions > 0) msg += ` ID collisions resolved: ${idCollisions}.`;
        if (conflictsResolved > 0) msg += ` Conflicts resolved: ${conflictsResolved}.`;
        console.log(msg);
    } else {
        // 上書きモード
        currentStore.tasks = normalizeTaskOrders(remoteStore.tasks);
        saveStore(currentStore);
        console.log(`Pulled from sync repository. (${remoteStore.tasks.length} tasks)`);
    }
}

function handleSet(positional: string[], options: Record<string, string | boolean>): void {
    // --- 検証フェーズ（副作用なし） ---
    const allowedKeys = new Set(['id', 'remote']);
    for (const key of Object.keys(options)) {
        if (!allowedKeys.has(key)) {
            console.error(`Unknown option: --${key}`);
            console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
            process.exit(1);
        }
    }
    if (positional.length > 1) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }

    if (options.remote === true) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }
    const remoteUrl = typeof options.remote === 'string' ? options.remote : null;
    if (remoteUrl !== null && !isSafeGitUrl(remoteUrl)) {
        console.error(`Invalid remote URL: "${remoteUrl}" (must not start with "-").`);
        process.exit(1);
    }

    if (options.id === true) {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }
    if (typeof options.id === 'string' && !isValidSyncId(options.id)) {
        console.error(`Invalid sync id: "${options.id}". Use only letters, digits, ".", "_", "-".`);
        process.exit(1);
    }

    const mode = positional[0];
    if (mode !== undefined && mode !== 'auto' && mode !== 'manual') {
        console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        process.exit(1);
    }

    const hasIdOrMode = typeof options.id === 'string' || mode === 'auto' || mode === 'manual';
    const syncConfig = loadSyncConfig();
    if (remoteUrl === null && !hasIdOrMode) {
        // 引数無しの呼び出しは、未同期プロジェクトでは従来どおり"Not synced"を案内する
        // （コードレビュー指摘対応: 検証フェーズ先行化で汎用usageに変わっていた回帰）
        if (!syncConfig?.enabled) {
            console.error('Not synced. Run "tm sync add" first.');
        } else {
            console.error('Usage: tm sync set [--id <name>] [--remote <url>] [auto|manual]');
        }
        process.exit(1);
    }

    if (hasIdOrMode && !syncConfig?.enabled) {
        console.error('Not synced. Run "tm sync add" first.');
        process.exit(1);
    }

    // --- 実行フェーズ ---
    if (remoteUrl !== null) {
        if (!ensureInitialized()) {
            console.error('Failed to initialize sync repository');
            process.exit(1);
        }
        const current = getSyncRemoteUrl();
        if (current === null) {
            const result = runGitCommandCapture(['remote', 'add', 'origin', remoteUrl]);
            if (result.status !== 0) {
                console.error('Failed to set remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin set to: ${remoteUrl}`);
        } else {
            const result = runGitCommandCapture(['remote', 'set-url', 'origin', remoteUrl]);
            if (result.status !== 0) {
                console.error('Failed to update remote origin.');
                console.error(result.stderr);
                process.exit(1);
            }
            console.log(`Remote origin changed: ${current} -> ${remoteUrl}`);
        }
        applyAutoAdopt();
    }

    if (hasIdOrMode && syncConfig) {
        if (typeof options.id === 'string') {
            syncConfig.id = options.id;
            console.log(`Sync ID set to: ${options.id}`);
        }
        if (mode === 'auto' || mode === 'manual') {
            syncConfig.auto = mode === 'auto';
            console.log(`Sync mode set to: ${mode}`);
        }
        saveSyncConfig(syncConfig);
    }
}

function handleStatus(): void {
    const syncConfig = loadSyncConfig();

    console.log('=== Sync Status ===');
    console.log(`Sync Directory: ${getSyncDir()}`);
    console.log(`Initialized: ${isSyncInitialized() ? 'Yes' : 'No'}`);
    console.log(`Remote: ${getSyncRemoteUrl() ?? 'Not configured'}`);
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
  clone <url>             Clone a remote sync repository to ~/.local/task-memory
  add [--id <name>] [--save] [--remote <url>]
                          Add current project to sync
  remove                  Remove current project from sync
  save                    Save tasks to sync directory
  push                    Push sync directory to remote
  pull [--merge]          Pull tasks from sync repository
  set [--id <name>] [--remote <url>] [auto|manual]
                          Set sync ID, remote URL, and/or mode
  status                  Show sync status
  list                    List synced projects

Examples:
  tm sync clone https://github.com/user/task-memory-sync.git
  tm sync add --id my-project --save --remote https://github.com/user/task-memory-sync.git
  tm sync push
  tm sync pull --merge
  tm sync set --remote https://github.com/user/task-memory-sync.git
    `);
}

export function syncCommand(args: string[]): void {
    const { subcommand, options, positional } = parseArgs(args);

    switch (subcommand) {
        case 'clone':
            handleClone(positional);
            break;
        case 'add':
            handleAdd(positional, options);
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
            handleSet(positional, options);
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
