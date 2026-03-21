import { describe, it, expect } from 'bun:test';
import { mergeTasks } from '../src/commands/sync';
import type { Task } from '../src/types';

function makeTask(overrides: Partial<Task> & { id: string; summary: string }): Task {
    return {
        status: 'todo',
        bodies: [],
        files: { read: [], edit: [] },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('mergeTasks', () => {
    it('新規タスクはそのまま追加される', () => {
        const local = [makeTask({ id: 'TASK-1', summary: 'Local task' })];
        const remote = [makeTask({ id: 'TASK-2', summary: 'Remote task' })];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(2);
        expect(result.tasks.find(t => t.id === 'TASK-2')?.summary).toBe('Remote task');
        expect(result.idCollisions).toBe(0);
        expect(result.conflictsResolved).toBe(0);
    });

    it('同一タスク（id+created_at一致）でリモートが新しければ上書き', () => {
        const local = [
            makeTask({ id: 'TASK-1', summary: 'Old summary', updated_at: '2026-01-01T00:00:00.000Z' }),
        ];
        const remote = [
            makeTask({ id: 'TASK-1', summary: 'New summary', updated_at: '2026-01-02T00:00:00.000Z' }),
        ];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]?.summary).toBe('New summary');
        expect(result.conflictsResolved).toBe(1);
        expect(result.idCollisions).toBe(0);
    });

    it('同一タスクでローカルが新しければローカルを保持', () => {
        const local = [
            makeTask({ id: 'TASK-1', summary: 'Newer local', updated_at: '2026-01-03T00:00:00.000Z' }),
        ];
        const remote = [
            makeTask({ id: 'TASK-1', summary: 'Older remote', updated_at: '2026-01-01T00:00:00.000Z' }),
        ];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]?.summary).toBe('Newer local');
        expect(result.conflictsResolved).toBe(0);
    });

    it('ID衝突（同じid・異なるcreated_at）はリモートに新IDを割り当てて追加', () => {
        const local = [
            makeTask({ id: 'TASK-1', summary: 'Local task 1', created_at: '2026-01-01T00:00:00.000Z' }),
        ];
        const remote = [
            makeTask({ id: 'TASK-1', summary: 'Different task with same ID', created_at: '2026-02-01T00:00:00.000Z' }),
        ];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(2);
        // ローカルのTASK-1は保持される
        expect(result.tasks.find(t => t.id === 'TASK-1')?.summary).toBe('Local task 1');
        // リモートは新しいIDで追加される
        const renamedTask = result.tasks.find(t => t.id !== 'TASK-1');
        expect(renamedTask?.summary).toBe('Different task with same ID');
        expect(renamedTask?.id).toBe('TASK-2');
        expect(result.idCollisions).toBe(1);
    });

    it('複数のID衝突を連続して処理できる', () => {
        const local = [
            makeTask({ id: 'TASK-1', summary: 'Local 1', created_at: '2026-01-01T00:00:00.000Z' }),
            makeTask({ id: 'TASK-2', summary: 'Local 2', created_at: '2026-01-01T00:00:00.000Z' }),
        ];
        const remote = [
            makeTask({ id: 'TASK-1', summary: 'Remote collision 1', created_at: '2026-02-01T00:00:00.000Z' }),
            makeTask({ id: 'TASK-2', summary: 'Remote collision 2', created_at: '2026-02-01T00:00:00.000Z' }),
        ];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(4);
        expect(result.idCollisions).toBe(2);
        // 新IDがユニークであること
        const ids = result.tasks.map(t => t.id);
        expect(new Set(ids).size).toBe(4);
    });

    it('ローカルが空のとき全リモートタスクを追加', () => {
        const local: Task[] = [];
        const remote = [
            makeTask({ id: 'TASK-1', summary: 'Remote 1' }),
            makeTask({ id: 'TASK-2', summary: 'Remote 2' }),
        ];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(2);
        expect(result.idCollisions).toBe(0);
        expect(result.conflictsResolved).toBe(0);
    });

    it('リモートが空のときローカルを保持', () => {
        const local = [makeTask({ id: 'TASK-1', summary: 'Local task' })];
        const remote: Task[] = [];

        const result = mergeTasks(local, remote);

        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]?.id).toBe('TASK-1');
    });
});
