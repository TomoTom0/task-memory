import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeCommand } from '../src/commands/close';
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

describe('tm close', () => {
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

    it('closes a task', () => {
        saveTasks([task({ status: 'wip' })]);
        closeCommand(['1']);
        expect(loadTasks()[0]!.status).toBe('closed');
    });

    it('allows closing a blocked task and clears its gate (with warning)', () => {
        saveTasks([task({ status: 'blocked', gate: 'cond' })]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        closeCommand(['1']);
        const t = loadTasks();
        expect(t[0]!.status).toBe('closed');
        expect(t[0]!.gate).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
