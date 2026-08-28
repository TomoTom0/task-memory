import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import type { Task, TaskStore, SyncConfig } from './types';
import { normalizeOrders, resolveDuplicateOrders } from './utils/orderUtils';

let globalMode = false;

export function setGlobalMode(mode: boolean): void {
    globalMode = mode;
}

export function isGlobalMode(): boolean {
    return globalMode;
}

export function findGitPath(startDir: string): string | null {
    let currentDir = startDir;
    const home = homedir();

    while (true) {
        const gitPath = join(currentDir, '.git');
        if (existsSync(gitPath)) {
            return gitPath;
        }

        if (currentDir === home) {
            return null;
        }

        const parentDir = dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }
        currentDir = parentDir;
    }
}

export class NotGitError extends Error {
    constructor() {
        super('Not a git repository. Use --global to use home directory, or run in a git repository.');
        this.name = 'NotGitError';
    }
}

export function resolveGitPath(): string | null {
    const agentRoot = process.env.CODING_AGENT_ROOT;
    if (agentRoot) {
        const gitPath = join(agentRoot, '.git');
        return existsSync(gitPath) ? gitPath : null;
    }
    return findGitPath(process.cwd());
}

export function getDbPath(): string {
    if (globalMode) {
        return join(homedir(), '.task-memory.json');
    }

    const gitPath = resolveGitPath();
    if (gitPath) {
        try {
            if (statSync(gitPath).isDirectory()) {
                return join(gitPath, 'task-memory.json');
            }
        } catch { }
        // .gitがファイル（worktree）の場合、プロジェクトルートに保存
        return join(dirname(gitPath), 'task-memory.json');
    }

    throw new NotGitError();
}

// 内部キャッシュ（sync設定を保持するため）
let cachedStore: TaskStore | null = null;

// 保存後のコールバック（自動同期用）
let afterSaveCallback: ((store: TaskStore) => void) | null = null;

export function setAfterSaveCallback(callback: (store: TaskStore) => void): void {
    afterSaveCallback = callback;
}

export function loadStore(): TaskStore {
    const dbPath = getDbPath();
    if (!existsSync(dbPath)) {
        return { tasks: [] };
    }
    try {
        const data = readFileSync(dbPath, 'utf-8');
        const parsed = JSON.parse(data);

        // 旧形式（配列）との互換性を維持
        if (Array.isArray(parsed)) {
            return { tasks: parsed as Task[] };
        }
        return parsed as TaskStore;
    } catch (e) {
        console.error(`Error loading store from ${dbPath}:`, e);
        return { tasks: [] };
    }
}

export function saveStore(store: TaskStore): void {
    const dbPath = getDbPath();
    try {
        writeFileSync(dbPath, JSON.stringify(store, null, 2), 'utf-8');
        cachedStore = store;
        if (afterSaveCallback) {
            afterSaveCallback(store);
        }
    } catch (e) {
        console.error(`Error saving store to ${dbPath}:`, e);
    }
}

export function loadTasks(): Task[] {
    const store = loadStore();
    cachedStore = store;
    return store.tasks;
}

/**
 * タスクの order を正規化する
 * todo, wip のタスクのみを対象とし、それ以外は null にする
 *
 * @param recentlySetOrderIds 今回の操作で order を設定したタスクIDの適用順（末尾が最新）。
 *   重複するorder値がある場合、ここに含まれる（＝より末尾に近い）タスクが優先され、
 *   他のタスクが繰り下げられる。渡さない場合は、タスク配列内の出現順で決定的に解消される。
 */
export function normalizeTaskOrders(tasks: Task[], recentlySetOrderIds: string[] = []): Task[] {
    // todo, wip のタスクのインデックスと order を収集
    const activeIndices: number[] = [];
    const activeOrders: (string | null)[] = [];
    const activeIds: string[] = [];

    tasks.forEach((task, index) => {
        if (task.status === 'todo' || task.status === 'wip') {
            activeIndices.push(index);
            activeOrders.push(task.order ?? null);
            activeIds.push(task.id);
        }
    });

    // 同一order値の重複を、適用順が新しい方を優先して微小な値に分離してから正規化する
    const priorities = activeIds.map((id) => recentlySetOrderIds.lastIndexOf(id));
    const resolvedOrders = resolveDuplicateOrders(activeOrders, priorities);
    const normalizedOrders = normalizeOrders(resolvedOrders);

    // 結果を反映
    const result = tasks.map((task, index) => {
        if (task.status === 'todo' || task.status === 'wip') {
            const activeIndex = activeIndices.indexOf(index);
            if (activeIndex !== -1) {
                return { ...task, order: normalizedOrders[activeIndex] };
            }
        }
        // todo, wip 以外は order を null に
        if (task.order !== null && task.order !== undefined) {
            return { ...task, order: null };
        }
        return task;
    });

    return result;
}

export function saveTasks(tasks: Task[], recentlySetOrderIds: string[] = []): void {
    // sync設定を保持しつつtasksを更新
    const store = cachedStore || loadStore();
    // order を正規化
    store.tasks = normalizeTaskOrders(tasks, recentlySetOrderIds);
    saveStore(store);
}

export function loadSyncConfig(): SyncConfig | undefined {
    const store = cachedStore || loadStore();
    return store.sync;
}

export function saveSyncConfig(sync: SyncConfig): void {
    const store = cachedStore || loadStore();
    store.sync = sync;
    saveStore(store);
}

export function getTaskById(tasks: Task[], idOrIndex: string | number): Task | undefined {
    if (typeof idOrIndex === 'number') {
        // If number, assume it matches the numeric part of TASK-N or index?
        // Design says: "User input integer 1 -> internally TASK-1"
        const targetId = `TASK-${idOrIndex}`;
        return tasks.find(t => t.id === targetId);
    }

    const idStr = idOrIndex.toString();
    if (idStr.match(/^\d+$/)) {
        return tasks.find(t => t.id === `TASK-${idStr}`);
    }

    return tasks.find(t => t.id === idStr);
}

export function getNextId(tasks: Task[]): string {
    // Find max ID
    let max = 0;
    for (const task of tasks) {
        const match = task.id.match(/^TASK-(\d+)$/);
        if (match) {
            const num = parseInt(match[1]!, 10);
            if (num > max) max = num;
        }
    }
    return `TASK-${max + 1}`;
}

export function getCurrentCommit(): string | undefined {
    const gitPath = resolveGitPath();
    if (!gitPath) return undefined;

    try {
        const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: dirname(gitPath),
            encoding: 'utf-8',
        });

        if (result.error || result.status !== 0 || !result.stdout) return undefined;
        const commit = result.stdout.trim();
        return commit || undefined;
    } catch {
        return undefined;
    }
}
