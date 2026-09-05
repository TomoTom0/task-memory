import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newCommand } from '../src/commands/new';
import { updateCommand } from '../src/commands/update';
import { finishCommand } from '../src/commands/finish';
import { closeCommand } from '../src/commands/close';
import { releaseCommand } from '../src/commands/release';
import { loadTasks, saveTasks, getCurrentCommit } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';
import { execSync } from 'child_process';

function setupTasks(tasks: Task[]) {
    saveTasks(tasks);
}

describe('getCurrentCommit', () => {
    it('should return undefined outside a real git repository', () => {
        // setup.tsがcwdとするsandbox projectの.gitは空ディレクトリ（実repoではない）。
        // git rev-parseは失敗し、決定的にundefinedを返す
        expect(getCurrentCommit()).toBeUndefined();
    });
});

describe('commit hash in git repo', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        // Initialize a real git repo with a commit
        execSync('git init', { cwd: tempDir });
        execSync('git config user.email "test@test.com"', { cwd: tempDir });
        execSync('git config user.name "Test"', { cwd: tempDir });
        execSync('git commit --allow-empty -m "initial"', { cwd: tempDir });
        process.chdir(tempDir);
        saveTasks([]);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('should record created_commit on tm new', () => {
        newCommand(['Task with commit']);
        const tasks = loadTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].created_commit).toBeDefined();
        expect(tasks[0].created_commit).toMatch(/^[0-9a-f]{7}$/);
        expect(tasks[0].updated_commit).toBe(tasks[0].created_commit);
    });

    it('should record updated_commit on tm update', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'Test', bodies: [], files: { read: [], edit: [] },
            created_at: '', updated_at: '', created_commit: 'abc1234'
        }]);

        updateCommand(['1', '--status', 'wip']);

        const tasks = loadTasks();
        expect(tasks[0]!.updated_commit).toBeDefined();
        expect(tasks[0]!.updated_commit).toMatch(/^[0-9a-f]{7}$/);
        // created_commit should be preserved
        expect(tasks[0]!.created_commit).toBe('abc1234');
    });

    it('should record updated_commit on tm finish', () => {
        setupTasks([{
            id: 'TASK-1', status: 'wip', summary: 'Test', bodies: [], files: { read: [], edit: [] },
            created_at: '', updated_at: '', created_commit: 'abc1234'
        }]);

        finishCommand(['1']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('done');
        expect(tasks[0]!.updated_commit).toBeDefined();
        expect(tasks[0]!.created_commit).toBe('abc1234');
    });

    it('should record updated_commit on tm close', () => {
        setupTasks([{
            id: 'TASK-1', status: 'todo', summary: 'Test', bodies: [], files: { read: [], edit: [] },
            created_at: '', updated_at: '', created_commit: 'abc1234'
        }]);

        closeCommand(['1']);

        const tasks = loadTasks();
        expect(tasks[0]!.status).toBe('closed');
        expect(tasks[0]!.updated_commit).toBeDefined();
        expect(tasks[0]!.created_commit).toBe('abc1234');
    });

    it('should record updated_commit on tm release', () => {
        setupTasks([{
            id: 'TASK-1', status: 'done', summary: 'Test', bodies: [], files: { read: [], edit: [] },
            created_at: '', updated_at: '', created_commit: 'abc1234'
        }]);

        releaseCommand(['1', '--version', '1.0.0']);

        const tasks = loadTasks();
        expect(tasks[0]!.version).toBe('1.0.0');
        expect(tasks[0]!.updated_commit).toBeDefined();
        expect(tasks[0]!.created_commit).toBe('abc1234');
    });

    it('should update commit after new commit in repo', () => {
        newCommand(['Task 1']);
        const beforeCommit = loadTasks()[0]!.created_commit;

        // Create a new commit in the repo
        execSync('git commit --allow-empty -m "second"', { cwd: tempDir });

        updateCommand(['1', '--body', 'Updated']);

        const tasks = loadTasks();
        expect(tasks[0]!.updated_commit).toBeDefined();
        expect(tasks[0]!.updated_commit).not.toBe(beforeCommit);
        expect(tasks[0]!.created_commit).toBe(beforeCommit);
    });
});
