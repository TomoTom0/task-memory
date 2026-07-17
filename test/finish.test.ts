import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { finishCommand } from '../src/commands/finish';
import { saveTasks, loadTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function task(over: Partial<Task> = {}): Task {
    return {
        id: 'TASK-1',
        status: 'todo',
        summary: 'T',
        bodies: [],
        files: { read: [], edit: [] },
        created_at: '',
        updated_at: '',
        ...over,
    };
}

describe('tm finish', () => {
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

    it('marks a task as done', () => {
        saveTasks([task({ status: 'wip' })]);
        finishCommand(['1']);
        expect(loadTasks()[0]!.status).toBe('done');
    });

    it('rejects finishing a blocked task (status and gate preserved)', () => {
        saveTasks([task({ status: 'blocked', gate: 'cond' })]);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        finishCommand(['1']);
        const t = loadTasks();
        expect(t[0]!.status).toBe('blocked');
        expect(t[0]!.gate).toBe('cond');
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });

    it('finishes non-blocked tasks in a batch while skipping a blocked one', () => {
        saveTasks([
            task({ id: 'TASK-1', status: 'todo' }),
            task({ id: 'TASK-2', status: 'blocked', gate: 'cond' }),
            task({ id: 'TASK-3', status: 'wip' }),
        ]);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        finishCommand(['1', '2', '3']);
        err.mockRestore();
        const tasks = loadTasks();
        expect(tasks.find(t => t.id === 'TASK-1')!.status).toBe('done');
        expect(tasks.find(t => t.id === 'TASK-2')!.status).toBe('blocked');
        expect(tasks.find(t => t.id === 'TASK-3')!.status).toBe('done');
    });
});
