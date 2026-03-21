import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestProject, cleanup, runTm } from './helpers/testProject';

describe('tm review', () => {
    let projectDir: string;

    beforeAll(() => {
        projectDir = createTestProject();
    });

    afterAll(() => {
        cleanup(projectDir);
    });

    it('should create a new review', () => {
        const result = runTm(['review', 'new', 'Test Review', '--body', 'This is a test'], projectDir);
        expect(result.exitCode).toBe(0);

        const list = runTm(['review', 'list'], projectDir);
        expect(list.stdout).toContain('Test Review');
    });

    it('should update a review', () => {
        runTm(['review', 'new', 'Update Me'], projectDir);
        const list = runTm(['review', 'list'], projectDir);
        const match = list.stdout.match(/REVIEW-\d+/);
        expect(match).toBeTruthy();
        const id = match![0]!;

        const result = runTm(['review', 'update', id, '--status', 'wip', '--body', 'Working on it'], projectDir);
        expect(result.exitCode).toBe(0);

        const updated = runTm(['review', 'list', '-s', 'wip'], projectDir);
        expect(updated.stdout).toContain('Update Me');
    });

    it('should accept a review and create tasks', () => {
        runTm(['review', 'new', 'Accept Me'], projectDir);
        const list = runTm(['review', 'list'], projectDir);
        const match = list.stdout.match(/REVIEW-\d+/);
        expect(match).toBeTruthy();
        const id = match![0]!;

        const result = runTm(['review', 'accept', id, '--new', 'Task 1', '--status', 'todo', '--new', 'Task 2', '--priority', 'high'], projectDir);
        expect(result.exitCode).toBe(0);

        const tasks = runTm(['list'], projectDir);
        expect(tasks.stdout).toContain('Task 1');
        expect(tasks.stdout).toContain('Task 2');
    });

    it('should reject a review', () => {
        const dir = createTestProject();
        runTm(['review', 'new', 'Reject Me'], dir);
        const list = runTm(['review', 'list'], dir);
        const match = list.stdout.match(/REVIEW-\d+/);
        expect(match).toBeTruthy();
        const id = match![0]!;

        const result = runTm(['review', 'reject', id], dir);
        expect(result.exitCode).toBe(0);

        // reject後はアクティブリストから消える
        const after = runTm(['review', 'list'], dir);
        expect(after.stdout).not.toContain('Reject Me');

        cleanup(dir);
    });
});
