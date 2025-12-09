import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { listCommand } from '../src/commands/list';
import { saveTasks } from '../src/store';
import { saveReviews } from '../src/reviewStore';
import type { Task } from '../src/types';

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

    it('should list all active tasks with --all flag', () => {
        saveTasks([
            { id: '1', status: 'todo', summary: 'Todo Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
            { id: '3', status: 'pending', summary: 'Pending Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);

        listCommand(['--all']);

        expect(logSpy).toHaveBeenCalledTimes(2);
        expect(logSpy.mock.calls[0][0]).toContain('Todo Task');
        expect(logSpy.mock.calls[1][0]).toContain('Pending Task');
    });

    it('should list all active tasks with -a flag', () => {
        saveTasks([
            { id: '4', status: 'long', summary: 'Long Task', bodies: [], files: { read: [], edit: [] }, created_at: '', updated_at: '' },
        ]);

        listCommand(['-a']);

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0][0]).toContain('Long Task');
    });
});
