import { describe, it, expect, beforeEach } from 'bun:test';
import { newCommand } from '../src/commands/new';
import { loadTasks, saveTasks } from '../src/store';
import type { Task } from '../src/types';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

// Helper to setup initial state
function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

describe('tm new argument parsing', () => {
    // Clear tasks before each test
    beforeEach(() => {
        saveTasks([]);
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
});
