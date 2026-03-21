import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestProject, cleanup, runTm } from './helpers/testProject';

describe('tm list', () => {
    let projectDir: string;

    beforeAll(() => {
        projectDir = createTestProject();
        runTm(['new', 'Todo Task', '--status', 'todo'], projectDir);
        runTm(['new', 'Wip Task', '--status', 'wip'], projectDir);
        runTm(['new', 'Pending Task', '--status', 'pending'], projectDir);
        runTm(['new', 'Done Task', '--status', 'done'], projectDir);
    });

    afterAll(() => {
        cleanup(projectDir);
    });

    it('should list only todo and wip tasks by default', () => {
        const result = runTm(['list'], projectDir);
        expect(result.stdout).toContain('Todo Task');
        expect(result.stdout).toContain('Wip Task');
        expect(result.stdout).not.toContain('Pending Task');
        expect(result.stdout).not.toContain('Done Task');
    });

    it('should list done tasks with -s done', () => {
        const result = runTm(['list', '-s', 'done'], projectDir);
        expect(result.stdout).toContain('Done Task');
        expect(result.stdout).not.toContain('Todo Task');
    });

    it('should list pending tasks with -s pending', () => {
        const result = runTm(['list', '-s', 'pending'], projectDir);
        expect(result.stdout).toContain('Pending Task');
        expect(result.stdout).not.toContain('Todo Task');
    });
});

describe('tm list order', () => {
    it('should sort tasks by order before unordered tasks', () => {
        const dir = createTestProject();
        // orderなしタスクを作成
        runTm(['new', 'No Order A'], dir);
        runTm(['new', 'No Order B'], dir);
        // orderありタスクを作成
        const r = runTm(['new', 'Has Order'], dir);
        const id = r.stdout.match(/TASK-(\d+)/)?.[1]!;
        runTm(['update', id, '--order', '1'], dir);

        const result = runTm(['list'], dir);
        const lines = result.stdout.trim().split('\n');
        const hasOrderIdx = lines.findIndex(l => l.includes('Has Order'));
        const noOrderAIdx = lines.findIndex(l => l.includes('No Order A'));
        const noOrderBIdx = lines.findIndex(l => l.includes('No Order B'));

        expect(hasOrderIdx).toBeLessThan(noOrderAIdx);
        expect(hasOrderIdx).toBeLessThan(noOrderBIdx);

        cleanup(dir);
    });

    it('should sort by ID with --sort id option', () => {
        const dir = createTestProject();
        // ID順 (作成順): TASK-1, TASK-2, TASK-3
        runTm(['new', 'Third', '--order', '3'], dir);
        runTm(['new', 'First', '--order', '1'], dir);
        runTm(['new', 'Second', '--order', '2'], dir);

        const result = runTm(['list', '--sort', 'id'], dir);
        const lines = result.stdout.trim().split('\n');

        // 出力形式は "N: summary [status]"
        // ID順: 1=Third, 2=First, 3=Second
        const ids = lines.map(l => parseInt(l.split(':')[0] ?? '', 10)).filter(n => !isNaN(n));
        for (let i = 1; i < ids.length; i++) {
            expect(ids[i]).toBeGreaterThan(ids[i - 1]!);
        }

        cleanup(dir);
    });

    it('should place tasks without order at the end', () => {
        const dir = createTestProject();
        runTm(['new', 'No Order'], dir);
        runTm(['new', 'Has Order', '--order', '1'], dir);

        const result = runTm(['list'], dir);
        const lines = result.stdout.trim().split('\n');
        const hasOrderIdx = lines.findIndex(l => l.includes('Has Order'));
        const noOrderIdx = lines.findIndex(l => l.includes('No Order'));
        expect(hasOrderIdx).toBeLessThan(noOrderIdx);

        cleanup(dir);
    });
});
