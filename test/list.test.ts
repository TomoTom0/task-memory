import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { listCommand } from '../src/commands/list';
import { saveTasks } from '../src/store';
import { saveReviews } from '../src/reviewStore';
import type { Task, Review } from '../src/types';

describe('tm list command', () => {
    // Mock console.log
    const logSpy = spyOn(console, 'log');

    beforeEach(() => {
        logSpy.mockClear();
        saveTasks([]);
        saveReviews([]);
    });

    it('should list only todo and wip tasks by default', () => {
        saveTasks([
            { id: '1', status: 'todo', summary: 'Todo Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '2', status: 'wip', summary: 'Wip Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '3', status: 'pending', summary: 'Pending Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '4', status: 'long', summary: 'Long Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '5', status: 'done', summary: 'Done Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Todo Task');
        expect(logSpy.mock.calls[1][0]).toContain('Wip Task');
    });

    it('should list all open tasks with --open flag', () => {
        saveTasks([
            { id: '1', status: 'todo', summary: 'Todo Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '3', status: 'pending', summary: 'Pending Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);

        listCommand(['--open']);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Todo Task');
        expect(logSpy.mock.calls[1][0]).toContain('Pending Task');
    });

    it('should list all tasks including done/closed with -a flag', () => {
        saveTasks([
            { id: '4', status: 'long', summary: 'Long Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '5', status: 'done', summary: 'Done Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);

        listCommand(['-a']);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Long Task');
        expect(logSpy.mock.calls[1][0]).toContain('Done Task');
    });

    it('should list checking reviews along with tasks', () => {
        saveTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Todo Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);
        saveReviews([
            { id: 'REVIEW-1', status: 'checking', title: 'Code Review', bodies: [], created_at: '', updated_at: '' },
            { id: 'REVIEW-2', status: 'reviewed', title: 'Already Reviewed', bodies: [], created_at: '', updated_at: '' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Todo Task');
        expect(logSpy.mock.calls[1][0]).toContain('Code Review');
        expect(logSpy.mock.calls[1][0]).toContain('checking');
    });

    it('should not list reviews with status other than checking', () => {
        saveTasks([]);
        saveReviews([
            { id: 'REVIEW-1', status: 'reviewed', title: 'Reviewed', bodies: [], created_at: '', updated_at: '' },
            { id: 'REVIEW-2', status: 'accepted', title: 'Accepted', bodies: [], created_at: '', updated_at: '' },
        ]);

        listCommand([]);

        expect(logSpy).not.toHaveBeenCalled();
    });

    it('should sort tasks by order by default', () => {
        saveTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Third', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '3' },
            { id: 'TASK-2', status: 'todo', summary: 'First', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
            { id: 'TASK-3', status: 'todo', summary: 'Second', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '2' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(3);
        expect(logSpy.mock.calls[0][0]).toContain('First');
        expect(logSpy.mock.calls[1][0]).toContain('Second');
        expect(logSpy.mock.calls[2][0]).toContain('Third');
    });

    it('should sort hierarchical orders correctly', () => {
        saveTasks([
            { id: 'TASK-1', status: 'todo', summary: 'Two', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '2' },
            { id: 'TASK-2', status: 'todo', summary: 'One-One', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1-1' },
            { id: 'TASK-3', status: 'todo', summary: 'One', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(3);
        expect(logSpy.mock.calls[0][0]).toContain('One');
        expect(logSpy.mock.calls[0][0]).not.toContain('One-One');
        expect(logSpy.mock.calls[1][0]).toContain('One-One');
        expect(logSpy.mock.calls[2][0]).toContain('Two');
    });

    it('should place tasks without order at the end', () => {
        saveTasks([
            { id: 'TASK-1', status: 'todo', summary: 'No Order', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: 'TASK-2', status: 'todo', summary: 'Has Order', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Has Order');
        expect(logSpy.mock.calls[1][0]).toContain('No Order');
    });

    it('should sort by ID when orders are same', () => {
        saveTasks([
            { id: 'TASK-3', status: 'todo', summary: 'C', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
            { id: 'TASK-1', status: 'todo', summary: 'A', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
            { id: 'TASK-2', status: 'todo', summary: 'B', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
        ]);

        listCommand([]);

        expect(logSpy).toHaveBeenCalledTimes(3);
        expect(logSpy.mock.calls[0][0]).toContain('A');
        expect(logSpy.mock.calls[1][0]).toContain('B');
        expect(logSpy.mock.calls[2][0]).toContain('C');
    });

    it('should sort by ID with --sort id option', () => {
        saveTasks([
            { id: 'TASK-3', status: 'todo', summary: 'Third ID', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '1' },
            { id: 'TASK-1', status: 'todo', summary: 'First ID', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '3' },
            { id: 'TASK-2', status: 'todo', summary: 'Second ID', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '', order: '2' },
        ]);

        listCommand(['--sort', 'id']);

        expect(logSpy).toHaveBeenCalledTimes(3);
        expect(logSpy.mock.calls[0][0]).toContain('First ID');
        expect(logSpy.mock.calls[1][0]).toContain('Second ID');
        expect(logSpy.mock.calls[2][0]).toContain('Third ID');
    });
});
