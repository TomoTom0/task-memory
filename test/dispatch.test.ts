import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dispatch, getHelpText } from '../src/index';
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

describe('tm index routing', () => {
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

    describe('getHelpText', () => {
        it('documents blocked-related commands and options', () => {
            const help = getHelpText();
            expect(help).toContain('block');
            expect(help).toContain('unblock');
            expect(help).toContain('--gate');
            expect(help).toContain('--force');
            expect(help).toContain('blocked');
        });
    });

    describe('dispatch routing', () => {
        it('routes "block" to blockCommand', () => {
            saveTasks([task()]);
            dispatch('block', ['1', '--gate', 'cond']);
            const t = loadTasks();
            expect(t[0]!.status).toBe('blocked');
            expect(t[0]!.gate).toBe('cond');
        });

        it('routes "unblock" to unblockCommand', () => {
            saveTasks([task({ status: 'blocked', gate: 'cond' })]);
            dispatch('unblock', ['1']);
            const t = loadTasks();
            expect(t[0]!.status).toBe('todo');
            expect(t[0]!.gate).toBeUndefined();
        });

        it('prints help text for the help command', () => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            dispatch('help', []);
            expect(log).toHaveBeenCalled();
            const output = log.mock.calls[0]![0] as string;
            expect(output).toContain('block');
            log.mockRestore();
        });

        it('errors and exits on an unknown command', () => {
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
                throw new Error('exit');
            });
            expect(() => dispatch('foobar', [])).toThrow('exit');
            expect(err).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
            err.mockRestore();
            exit.mockRestore();
        });

        it('prints usage when no command is given', () => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            dispatch(undefined, []);
            expect(log).toHaveBeenCalled();
            log.mockRestore();
        });
    });
});
