import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { blockCommand } from '../src/commands/block';
import { unblockCommand } from '../src/commands/unblock';
import { saveTasks, loadTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function task(over: Partial<Task> = {}): Task {
    return {
        id: 'TASK-1',
        status: 'todo',
        summary: 'Test',
        bodies: [],
        files: { read: [], edit: [] },
        created_at: '',
        updated_at: '',
        ...over,
    };
}

describe('tm block / tm unblock', () => {
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

    describe('block', () => {
        it('marks a task blocked with gate and clears order', () => {
            saveTasks([task({ order: '1' })]);
            blockCommand(['1', '--gate', 'TASK-2 done']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('blocked');
            expect(tasks[0]!.gate).toBe('TASK-2 done');
            expect(tasks[0]!.order).toBeNull();
        });

        it('requires --gate', () => {
            saveTasks([task()]);
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            blockCommand(['1']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('todo');
            expect(err).toHaveBeenCalled();
            err.mockRestore();
        });

        it('rejects unknown short options instead of treating them as ids', () => {
            saveTasks([task()]);
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            blockCommand(['1', '-x']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('todo');
            expect(err.mock.calls[0]?.[0]).toContain("Unknown option '-x'");
            err.mockRestore();
        });

        it('rejects blocking done/closed tasks', () => {
            saveTasks([
                task({ id: 'TASK-1', status: 'done' }),
                task({ id: 'TASK-2', status: 'closed' }),
            ]);
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            blockCommand(['1', '2', '--gate', 'x']);
            err.mockRestore();

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('done');
            expect(tasks[1]!.status).toBe('closed');
        });

        it('updates gate when already blocked (idempotent)', () => {
            saveTasks([task({ status: 'blocked', gate: 'old' })]);
            blockCommand(['1', '--gate', 'new']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('blocked');
            expect(tasks[0]!.gate).toBe('new');
        });
    });

    describe('unblock', () => {
        it('clears gate and moves to todo by default', () => {
            saveTasks([task({ status: 'blocked', gate: 'cond' })]);
            unblockCommand(['1']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('todo');
            expect(tasks[0]!.gate).toBeUndefined();
        });

        it('moves to wip with --status wip', () => {
            saveTasks([task({ status: 'blocked', gate: 'cond' })]);
            unblockCommand(['1', '--status', 'wip']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('wip');
            expect(tasks[0]!.gate).toBeUndefined();
        });

        it('skips non-blocked tasks', () => {
            saveTasks([task({ status: 'todo' })]);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            unblockCommand(['1']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('todo');
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it('rejects invalid --status', () => {
            saveTasks([task({ status: 'blocked', gate: 'cond' })]);
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            unblockCommand(['1', '--status', 'done']);
            err.mockRestore();

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('blocked');
        });

        it('rejects unknown short options instead of treating them as ids', () => {
            saveTasks([task({ status: 'blocked', gate: 'cond' })]);
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            unblockCommand(['1', '-x']);

            const tasks = loadTasks();
            expect(tasks[0]!.status).toBe('blocked');
            expect(err.mock.calls[0]?.[0]).toContain("Unknown option '-x'");
            err.mockRestore();
        });
    });
});
