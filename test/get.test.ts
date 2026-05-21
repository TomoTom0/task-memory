import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCommand } from '../src/commands/get';
import { saveTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

function captureOutput(fn: () => void): string {
    const lines: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    try {
        fn();
    } finally {
        console.log = origLog;
        console.error = origErr;
    }
    return lines.join('\n');
}

describe('tm get', () => {
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

    const makeTask = (bodies: { text: string; created_at: string }[] = []): Task => ({
        id: 'TASK-1', status: 'todo', summary: 'Test', bodies, files: { read: [], edit: [] },
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    });

    it('should show single body without note', () => {
        setupTasks([makeTask([{ text: 'only body', created_at: '2026-01-01T00:00:00.000Z' }])]);
        const out = captureOutput(() => getCommand(['1']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(1);
        expect(parsed[0].bodies[0].text).toBe('only body');
        expect(parsed[0]._bodies_note).toBeUndefined();
    });

    it('should show latest body with note when multiple bodies exist', () => {
        setupTasks([makeTask([
            { text: 'first', created_at: '2026-01-01T00:00:00.000Z' },
            { text: 'second', created_at: '2026-01-02T00:00:00.000Z' },
            { text: 'third', created_at: '2026-01-03T00:00:00.000Z' },
        ])]);
        const out = captureOutput(() => getCommand(['1']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(1);
        expect(parsed[0].bodies[0].text).toBe('third');
        expect(parsed[0]._bodies_note).toBe('他2件のbodyあり (--all で全表示, --last N で最新N件)');
    });

    it('should show all bodies with --all', () => {
        setupTasks([makeTask([
            { text: 'first', created_at: '2026-01-01T00:00:00.000Z' },
            { text: 'second', created_at: '2026-01-02T00:00:00.000Z' },
        ])]);
        const out = captureOutput(() => getCommand(['1', '--all']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(2);
        expect(parsed[0]._bodies_note).toBeUndefined();
    });

    it('should show first and last bodies with --last 2', () => {
        setupTasks([makeTask([
            { text: 'first', created_at: '2026-01-01T00:00:00.000Z' },
            { text: 'second', created_at: '2026-01-02T00:00:00.000Z' },
            { text: 'third', created_at: '2026-01-03T00:00:00.000Z' },
        ])]);
        const out = captureOutput(() => getCommand(['1', '--last', '2']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(2);
        expect(parsed[0].bodies[0].text).toBe('first');
        expect(parsed[0].bodies[1].text).toBe('third');
        expect(parsed[0]._bodies_note).toBe('1件のbody省略 (--all で全表示)');
    });

    it('should show all bodies with --last when N >= total', () => {
        setupTasks([makeTask([
            { text: 'first', created_at: '2026-01-01T00:00:00.000Z' },
            { text: 'second', created_at: '2026-01-02T00:00:00.000Z' },
        ])]);
        const out = captureOutput(() => getCommand(['1', '--last', '5']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(2);
        expect(parsed[0]._bodies_note).toBeUndefined();
    });

    it('should reject invalid --last value', () => {
        const out = captureOutput(() => getCommand(['1', '--last', 'abc']));
        expect(out).toContain('Error');
    });

    it('should reject --last without value', () => {
        const out = captureOutput(() => getCommand(['1', '--last']));
        expect(out).toContain('Error');
    });

    it('should show no bodies note when bodies is empty', () => {
        setupTasks([makeTask([])]);
        const out = captureOutput(() => getCommand(['1']));
        const parsed = JSON.parse(out);
        expect(parsed[0].bodies).toHaveLength(0);
        expect(parsed[0]._bodies_note).toBeUndefined();
    });
});
