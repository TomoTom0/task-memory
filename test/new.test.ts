import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestProject, cleanup, runTm } from './helpers/testProject';

describe('tm new', () => {
    let projectDir: string;

    beforeAll(() => {
        projectDir = createTestProject();
    });

    afterAll(() => {
        cleanup(projectDir);
    });

    it('should create task with summary only', () => {
        const result = runTm(['new', 'Simple', 'Task'], projectDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Simple Task');

        const list = runTm(['list'], projectDir);
        expect(list.stdout).toContain('Simple Task');
        expect(list.stdout).toContain('todo');
    });

    it('should create task with --status option', () => {
        const result = runTm(['new', 'Wip Task', '--status', 'wip'], projectDir);
        expect(result.exitCode).toBe(0);

        const list = runTm(['list', '-s', 'wip'], projectDir);
        expect(list.stdout).toContain('Wip Task');
    });

    it('should create task with --body option', () => {
        const result = runTm(['new', 'Task With Body', '--body', 'Initial body'], projectDir);
        expect(result.exitCode).toBe(0);

        const taskId = result.stdout.match(/TASK-\d+/)?.[0];
        expect(taskId).toBeTruthy();

        const get = runTm(['get', taskId!], projectDir);
        expect(get.stdout).toContain('Initial body');
    });

    it('should create task with --goal option', () => {
        const result = runTm(['new', 'Goal Task', '--goal', 'Achieve something'], projectDir);
        expect(result.exitCode).toBe(0);

        const taskId = result.stdout.match(/TASK-\d+/)?.[0];
        const get = runTm(['get', taskId!], projectDir);
        expect(get.stdout).toContain('Achieve something');
    });

    it('should create task with --order option', () => {
        const result = runTm(['new', 'Ordered Task', '--order', '1'], projectDir);
        expect(result.exitCode).toBe(0);

        const taskId = result.stdout.match(/TASK-\d+/)?.[0];
        const get = runTm(['get', taskId!], projectDir);
        expect(get.stdout).toContain('"order"');
    });
});
