import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { Task, TaskStore } from './types';

const DB_PATH = join(homedir(), '.task-memory.json');

export function loadTasks(): Task[] {
    if (!existsSync(DB_PATH)) {
        return [];
    }
    try {
        const data = readFileSync(DB_PATH, 'utf-8');
        const store: TaskStore = JSON.parse(data);
        // Handle case where file exists but might be empty or different structure initially
        // For now assume it matches TaskStore or is array of tasks if we change schema later
        // The design says "Task Object" but implies a collection. 
        // Let's assume the file contains an object with a "tasks" property or just an array.
        // The design example shows a single Task Object. 
        // But we need to store multiple tasks. 
        // "Data is persisted in a local JSON file... Task Object...".
        // Usually a list of tasks. Let's stick to TaskStore { tasks: [] } or just Task[]
        // Design doesn't explicitly define the root. Let's use { tasks: Task[] } for extensibility
        // or just Task[] for simplicity as per "Output: JSON array" in `tm get --all`.
        // Let's use an array of tasks as the root for simplicity based on `tm list` needing to iterate.

        if (Array.isArray(store)) {
            return store as Task[];
        }
        return (store as any).tasks || [];
    } catch (e) {
        console.error(`Error loading tasks from ${DB_PATH}:`, e);
        return [];
    }
}

export function saveTasks(tasks: Task[]): void {
    try {
        writeFileSync(DB_PATH, JSON.stringify(tasks, null, 2), 'utf-8');
    } catch (e) {
        console.error(`Error saving tasks to ${DB_PATH}:`, e);
    }
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
            const num = parseInt(match[1], 10);
            if (num > max) max = num;
        }
    }
    return `TASK-${max + 1}`;
}
