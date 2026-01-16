import { join, resolve, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import type { Task, TaskStore, SyncConfig } from './types';
import { normalizeOrders } from './utils/orderUtils';

export function findGitDir(startDir: string): string | null {
    let currentDir = startDir;
    const home = homedir();

    while (true) {
        const gitDir = join(currentDir, '.git');
        if (existsSync(gitDir)) {
            try {
                if (statSync(gitDir).isDirectory()) {
                    return gitDir;
                }
            } catch (e) {
                // ignore
            }
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

export function getDbPath(): string {
    if (process.env.TASK_MEMORY_PATH) {
        return resolve(process.cwd(), process.env.TASK_MEMORY_PATH);
    }

    const gitDir = findGitDir(process.cwd());
    if (gitDir) {
        return join(gitDir, 'task-memory.json');
    }

    return join(homedir(), '.task-memory.json');
}

const DB_PATH = getDbPath();

// 内部キャッシュ（sync設定を保持するため）
let cachedStore: TaskStore | null = null;

// 保存後のコールバック（自動同期用）
let afterSaveCallback: ((store: TaskStore) => void) | null = null;

export function setAfterSaveCallback(callback: (store: TaskStore) => void): void {
    afterSaveCallback = callback;
}

export function loadStore(): TaskStore {
    if (!existsSync(DB_PATH)) {
        return { tasks: [] };
    }
    try {
        const data = readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(data);

        // 旧形式（配列）との互換性を維持
        if (Array.isArray(parsed)) {
            return { tasks: parsed as Task[] };
        }
        return parsed as TaskStore;
    } catch (e) {
        console.error(`Error loading store from ${DB_PATH}:`, e);
        return { tasks: [] };
    }
}

export function saveStore(store: TaskStore): void {
    try {
        writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf-8');
        cachedStore = store;
        if (afterSaveCallback) {
            afterSaveCallback(store);
        }
    } catch (e) {
        console.error(`Error saving store to ${DB_PATH}:`, e);
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
 */
function normalizeTaskOrders(tasks: Task[]): Task[] {
    // todo, wip のタスクのインデックスと order を収集
    const activeIndices: number[] = [];
    const activeOrders: (string | null)[] = [];

    tasks.forEach((task, index) => {
        if (task.status === 'todo' || task.status === 'wip') {
            activeIndices.push(index);
            activeOrders.push(task.order ?? null);
        }
    });

    // 正規化
    const normalizedOrders = normalizeOrders(activeOrders);

    // 結果を反映
    const result = tasks.map((task, index) => {
        if (task.status === 'todo' || task.status === 'wip') {
            const activeIndex = activeIndices.indexOf(index);
            if (activeIndex !== -1) {
                const newOrder = normalizedOrders[activeIndex];
                if (task.order !== newOrder) {
                    return { ...task, order: newOrder };
                }
            }
            return task;
        } else {
            if (task.order != null) {
                return { ...task, order: null };
            }
            return task;
        }
    });

    return result;
}

export function saveTasks(tasks: Task[]): void {
    // sync設定を保持しつつtasksを更新
    const store = cachedStore || loadStore();
    // order を正規化
    store.tasks = normalizeTaskOrders(tasks);
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
