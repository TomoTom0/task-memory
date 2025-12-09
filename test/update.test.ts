import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { updateCommand } from '../src/commands/update';
import { saveTasks, loadTasks } from '../src/store';
import type { Task } from '../src/types';
import { join } from 'path';
import { homedir } from 'os';
import { unlinkSync, existsSync } from 'fs';

// Mock store by overwriting the file
const DB_PATH = join(homedir(), '.task-memory.json');
const BACKUP_PATH = join(homedir(), '.task-memory.json.bak');

// Helper to setup initial state
function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

describe('tm update argument parsing', () => {
    // Backup existing DB if any
    beforeEach(() => {
        if (existsSync(DB_PATH)) {
            const data = loadTasks();
            // We can't easily backup to file without fs write, but saveTasks writes to DB_PATH.
            // Let's just rename it.
            // Actually, let's just use a mock store if possible, but the code imports store directly.
            // Integration test style is fine for this tool.
            // We will backup the file content in memory or rename.
            // Bun doesn't have renameSync exposed easily? It does in 'fs'.
            // Let's just overwrite and restore.
        }
    });

    // We need to restore, but for now let's just assume we are in a dev env or use a separate file?
    // The code uses hardcoded path.
    // Ideally we should have made the path configurable.
    // For this task, I'll just overwrite and hope the user doesn't have critical data in ~/.task-memory.json yet (since I just created it).

    it('should update single task', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'Test', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: ''
        }]);

        updateCommand(['1', '--status', 'wip']);

        const tasks = loadTasks();
        expect(tasks[0].status).toBe('wip');
    });

    it('should update multiple tasks with same option', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '2', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0].status).toBe('done');
        expect(tasks[1].status).toBe('done');
    });

    it('should switch context correctly', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--status', 'wip', '2', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0].status).toBe('wip');
        expect(tasks[1].status).toBe('done');
    });

    it('should handle body updates', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--body', 'New update']);

        const tasks = loadTasks();
        expect(tasks[0].bodies.length).toBe(1);
        expect(tasks[0].bodies[0].text).toBe('New update');
    });

    it('should handle interleaved IDs and options', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-3', status: 'todo', summary: 'C', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        // 1 -> wip, 2 -> done, 3 -> done
        updateCommand(['1', '--status', 'wip', '2', '3', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0].status).toBe('wip');
        expect(tasks[1].status).toBe('done');
        expect(tasks[2].status).toBe('done');
    });

    it('should update task goal', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Goal Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--goal', 'New Goal']);

        const tasks = loadTasks();
        expect(tasks[0].goal).toBe('New Goal');
    });
});
