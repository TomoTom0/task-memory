import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reviewCommand } from '../src/commands/review';
import { loadReviews, saveReviews } from '../src/reviewStore';
import { loadTasks, saveTasks } from '../src/store';
import { createTempProject, removeTempDir } from './helpers';

describe('tm review command', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
        saveReviews([]);
        saveTasks([]);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('should create a new review', () => {
        reviewCommand(['new', 'Test Review', '--body', 'This is a test']);
        const reviews = loadReviews();
        expect(reviews.length).toBe(1);
        expect(reviews[0].title).toBe('Test Review');
        expect(reviews[0].bodies[0].text).toBe('This is a test');
        expect(reviews[0].status).toBe('todo');
    });

    it('should update a review', () => {
        reviewCommand(['new', 'Update Me']);
        let reviews = loadReviews();
        const id = reviews[0].id;

        reviewCommand(['update', id, '--status', 'wip', '--body', 'Working on it']);
        reviews = loadReviews();
        expect(reviews[0].status).toBe('wip');
        expect(reviews[0].bodies[reviews[0].bodies.length - 1].text).toBe('Working on it');
        expect(reviews[0].bodies.length).toBe(2);
    });

    it('should accept a review and create tasks', () => {
        reviewCommand(['new', 'Accept Me']);
        let reviews = loadReviews();
        const id = reviews[0].id;

        reviewCommand(['accept', id, '--new', 'Task 1', '--status', 'todo', '--new', 'Task 2', '--priority', 'high']);

        reviews = loadReviews();
        expect(reviews[0].status).toBe('done');
        expect(reviews[0].related_task_ids?.length).toBe(2);

        const tasks = loadTasks();
        expect(tasks.length).toBe(2);
        expect(tasks[0].summary).toBe('Task 1');
        expect(tasks[1].summary).toBe('Task 2');
        expect(tasks[1].priority).toBe('high');
    });

    it('accept --new で既にorder=1のタスクがいる状態でも、新規作成タスクが1を得て既存タスクが繰り下がる', () => {
        saveTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Existing', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
        ]);

        reviewCommand(['new', 'Accept With Order']);
        const reviews = loadReviews();
        const id = reviews[0].id;

        reviewCommand(['accept', id, '--new', 'New From Review', '--order', '1']);

        const tasks = loadTasks();
        const created = tasks.find(t => t.summary === 'New From Review')!;
        const existing = tasks.find(t => t.summary === 'Existing')!;
        expect(created.order).toBe('1');
        expect(existing.order).toBe('2');
    });

    it('accept --new で不正な形式のorderを指定するとタスクが作成されない', () => {
        reviewCommand(['new', 'Accept With Bad Order']);
        const reviews = loadReviews();
        const id = reviews[0].id;
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});

        reviewCommand(['accept', id, '--new', 'Bad Order Task', '--order', 'abc']);

        expect(err).toHaveBeenCalledWith(expect.stringContaining('Invalid order format'));
        const tasks = loadTasks();
        expect(tasks.length).toBe(0);

        err.mockRestore();
    });

    it('should reject a review', () => {
        reviewCommand(['new', 'Reject Me']);
        let reviews = loadReviews();
        const id = reviews[0].id;

        reviewCommand(['reject', id]);
        reviews = loadReviews();
        expect(reviews[0].status).toBe('closed');
    });
});
