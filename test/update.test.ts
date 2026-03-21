import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestProject, cleanup, runTm } from './helpers/testProject';

describe('tm update', () => {
    let projectDir: string;

    beforeAll(() => {
        projectDir = createTestProject();
    });

    afterAll(() => {
        cleanup(projectDir);
    });

    function newTask(summary: string, opts: string[] = []): string {
        const result = runTm(['new', summary, ...opts], projectDir);
        const match = result.stdout.match(/TASK-(\d+)/);
        if (!match) throw new Error(`Failed to create task: ${result.stdout} ${result.stderr}`);
        return match[1]!;
    }

    it('should update single task status', () => {
        const id = newTask('Update Status');
        runTm(['update', id, '--status', 'wip'], projectDir);

        const result = runTm(['get', id], projectDir);
        expect(result.stdout).toContain('"wip"');
    });

    it('should update multiple tasks with same option', () => {
        const id1 = newTask('Multi A');
        const id2 = newTask('Multi B');

        runTm(['update', id1, id2, '--status', 'done'], projectDir);

        const r1 = runTm(['get', id1], projectDir);
        const r2 = runTm(['get', id2], projectDir);
        expect(r1.stdout).toContain('"done"');
        expect(r2.stdout).toContain('"done"');
    });

    it('should update task body', () => {
        const id = newTask('Body Task');
        runTm(['update', id, '--body', 'New update'], projectDir);

        const result = runTm(['get', id], projectDir);
        expect(result.stdout).toContain('New update');
    });

    it('should update task goal', () => {
        const id = newTask('Goal Task');
        runTm(['update', id, '--goal', 'New Goal'], projectDir);

        const result = runTm(['get', id], projectDir);
        expect(result.stdout).toContain('New Goal');
    });

    it('should update task version', () => {
        const id = newTask('Version Task');
        runTm(['update', id, '--version', '1.0.0'], projectDir);

        const result = runTm(['get', id], projectDir);
        expect(result.stdout).toContain('1.0.0');
    });

    it('should clear order when changing to done status', () => {
        const id = newTask('Order Task', ['--order', '1']);

        runTm(['update', id, '--status', 'done'], projectDir);

        const result = runTm(['get', id], projectDir);
        const parsed = JSON.parse(result.stdout);
        expect(parsed[0].order).toBeNull();
    });

    it('should update task order', () => {
        const id = newTask('Reorder Task');
        runTm(['update', id, '--order', '2'], projectDir);

        const result = runTm(['get', id], projectDir);
        expect(result.stdout).toContain('"order"');
    });

    it('should clear order with --order null', () => {
        const id = newTask('Clear Order', ['--order', '1']);
        runTm(['update', id, '--order', 'null'], projectDir);

        const result = runTm(['get', id], projectDir);
        const parsed = JSON.parse(result.stdout);
        expect(parsed[0].order).toBeNull();
    });
});
