import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { reviewCommand } from '../src/commands/review';
import { loadReviews, saveReviews } from '../src/reviewStore';
import { loadTasks, saveTasks } from '../src/store';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

describe('tm review command', () => {
    const testReviewFile = join(process.cwd(), 'review-memory.json');
    const testTaskFile = join(process.cwd(), 'task-memory.json');

    beforeEach(() => {
        process.env.REVIEW_MEMORY_PATH = 'review-memory.json';
        process.env.TASK_MEMORY_PATH = 'task-memory.json';
        saveReviews([]);
        saveTasks([]);
    });

    afterEach(() => {
        if (existsSync(testReviewFile)) unlinkSync(testReviewFile);
        if (existsSync(testTaskFile)) unlinkSync(testTaskFile);
        delete process.env.REVIEW_MEMORY_PATH;
        delete process.env.TASK_MEMORY_PATH;
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

    it('should reject a review', () => {
        reviewCommand(['new', 'Reject Me']);
        let reviews = loadReviews();
        const id = reviews[0].id;

        reviewCommand(['reject', id]);
        reviews = loadReviews();
        expect(reviews[0].status).toBe('closed');
    });
});
