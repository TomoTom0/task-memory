import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { updateCommand } from '../src/commands/update';
import { saveTasks, loadTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

describe('tm update argument parsing', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('should update single task', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'Test', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: ''
        }]);

        updateCommand(['1', '--status', 'wip']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('wip');
    });

    it('should update multiple tasks with same option', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '2', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('done');
        expect(tasks[1]!.status).toBe('done');
    });

    it('should switch context correctly', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--status', 'wip', '2', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('wip');
        expect(tasks[1]!.status).toBe('done');
    });

    it('should handle body updates', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--body', 'New update']);

        const tasks = loadTasks();
        expect(tasks[0]!.bodies.length).toBe(1);
        expect(tasks[0]!.bodies[0]!.text).toBe('New update');
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
        expect(tasks[0]!.status).toBe('wip');
        expect(tasks[1]!.status).toBe('done');
        expect(tasks[2]!.status).toBe('done');
    });

    it('should update task goal', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Goal Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--goal', 'New Goal']);

        const tasks = loadTasks();
        expect(tasks[0]!.goal).toBe('New Goal');
    });

    it('should update task version', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Version Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--version', '1.0.0']);

        const tasks = loadTasks();
        expect(tasks[0]!.version).toBe('1.0.0');
    });

    it('should update task order', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Order Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' }
        ]);

        updateCommand(['1', '--order', '1-2']);

        const tasks = loadTasks();
        // 単一タスクで 1-2 は 1-1 に正規化される
        expect(tasks[0]!.order).toBe('1-1');
    });

    it('should clear order when changing to non-todo/wip status', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' }
        ]);

        updateCommand(['1', '--status', 'done']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('done');
        expect(tasks[0]!.order).toBeNull();
    });

    it('should preserve order when changing between todo and wip', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1-2' }
        ]);

        updateCommand(['1', '--status', 'wip']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('wip');
        // 単一タスクで 1-2 は 1-1 に正規化される
        expect(tasks[0]!.order).toBe('1-1');
    });

    it('should clear order with --order null', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' }
        ]);

        updateCommand(['1', '--order', 'null']);

        const tasks = loadTasks();
        expect(tasks[0]!.order).toBeNull();
    });

    it('should normalize orders across tasks', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
            { id: 'TASK-2', status: 'wip', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '5' }
        ]);

        // 初期状態で [1, 5] -> 正規化 [1, 2]
        // TASK-1 の order を 4 に変更 -> [4, 2] -> 正規化 [2, 1]
        updateCommand(['1', '--order', '4']);

        const tasks = loadTasks();
        // TASK-2(order=2) < TASK-1(order=4) なので、正規化後は TASK-2=1, TASK-1=2
        expect(tasks.find(t => t.id === 'TASK-1')!.order).toBe('2');
        expect(tasks.find(t => t.id === 'TASK-2')!.order).toBe('1');
    });
});

describe('tm update blocked / gate', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('sets blocked with --status blocked --gate', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: ''
        }]);
        updateCommand(['1', '--status', 'blocked', '--gate', 'TASK-2 done']);
        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('blocked');
        expect(tasks[0]!.gate).toBe('TASK-2 done');
    });

    it('rejects --status blocked without --gate', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: ''
        }]);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        updateCommand(['1', '--status', 'blocked']);
        err.mockRestore();
        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('todo');
    });

    it('rejects --gate without --status blocked', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: ''
        }]);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        updateCommand(['1', '--gate', 'x']);
        err.mockRestore();
        const tasks = loadTasks();
        expect(tasks[0]!.gate).toBeUndefined();
    });

    it('forbids resuming a blocked task without --force', () => {
        setupTasks([{
            id: 'TASK-1', status: 'blocked', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', gate: 'cond'
        }]);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        updateCommand(['1', '--status', 'wip']);
        err.mockRestore();
        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('blocked');
        expect(tasks[0]!.gate).toBe('cond');
    });

    it('allows resuming a blocked task with --force (clears gate)', () => {
        setupTasks([{
            id: 'TASK-1', status: 'blocked', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', gate: 'cond'
        }]);
        updateCommand(['1', '--status', 'wip', '--force']);
        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('wip');
        expect(tasks[0]!.gate).toBeUndefined();
    });

    it('--force is order-independent', () => {
        setupTasks([{
            id: 'TASK-1', status: 'blocked', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', gate: 'cond'
        }]);
        updateCommand(['--force', '1', '--status', 'wip']);
        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('wip');
    });
});
