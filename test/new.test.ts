import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newCommand } from '../src/commands/new';
import { loadTasks, saveTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

describe('tm new argument parsing', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
        saveTasks([]);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('should create task with summary only', () => {
        newCommand(['Simple', 'Task']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].summary).toBe('Simple Task');
        expect(tasks[0].status).toBe('todo');
    });

    it('should create task with options', () => {
        newCommand(['Task', 'With', 'Options', '--status', 'wip', '--body', 'Initial body', '--add-file', 'src/test.ts']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].summary).toBe('Task With Options');
        expect(tasks[0].status).toBe('wip');
        expect(tasks[0].bodies.length).toBe(1);
        expect(tasks[0].bodies[0].text).toBe('Initial body');
        expect(tasks[0].files.edit).toContain('src/test.ts');
    });

    it('should handle options before summary', () => {
        newCommand(['--status', 'done', 'Task', 'Before']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].summary).toBe('Task Before');
        expect(tasks[0].status).toBe('done');
    });

    it('should create task with goal', () => {
        newCommand(['Task With Goal', '--goal', 'Complete this']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].summary).toBe('Task With Goal');
        expect(tasks[0].goal).toBe('Complete this');
    });

    it('should create task with order', () => {
        newCommand(['Task With Order', '--order', '1-2']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].summary).toBe('Task With Order');
        // 単一タスクで 1-2 は 1-1 に正規化される（1の子で唯一なので1番目）
        expect(tasks[0].order).toBe('1-1');
    });

    it('should create task with decimal order (normalized)', () => {
        newCommand(['Task 1', '--order', '1']);
        newCommand(['Task 2', '--order', '3']);
        newCommand(['Task 3', '--order', '5']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(3);
        // 正規化後: 1, 3, 5 -> 1, 2, 3
        expect(tasks.find(t => t.summary === 'Task 1')?.order).toBe('1');
        expect(tasks.find(t => t.summary === 'Task 2')?.order).toBe('2');
        expect(tasks.find(t => t.summary === 'Task 3')?.order).toBe('3');
    });

    it('should set order to null for non-todo/wip status', () => {
        newCommand(['Done Task', '--status', 'done', '--order', '1']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].order).toBeNull();
    });

    it('should create a blocked task with --gate', () => {
        newCommand(['Blocked Task', '--status', 'blocked', '--gate', 'API spec fixed']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].status).toBe('blocked');
        expect(tasks[0].gate).toBe('API spec fixed');
    });

    it('should not create a blocked task without --gate', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        newCommand(['Blocked Task', '--status', 'blocked']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(0);
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it('既にorder=1のタスクがいる状態で新規タスクをorder=1で作成すると、新規タスクが1を得て既存タスクが繰り下がる', () => {
        setupTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Existing', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
        ]);

        newCommand(['New Task', '--order', '1']);

        const tasks = loadTasks();
        const newTask = tasks.find(t => t.summary === 'New Task')!;
        const existing = tasks.find(t => t.summary === 'Existing')!;
        expect(newTask.order).toBe('1');
        expect(existing.order).toBe('2');
    });

    it('不正な形式のorderはエラーになりタスクは作成されない', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        newCommand(['Bad Order Task', '--order', 'abc']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(0);
        expect(err).toHaveBeenCalledWith(expect.stringContaining('Invalid order format'));
        err.mockRestore();
    });
});
