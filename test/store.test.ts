import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveTasks, loadTasks } from '../src/store';
import type { Task } from '../src/types';
import { createTempProject, removeTempDir } from './helpers';

function task(id: string, order: string | null, status: Task['status'] = 'todo'): Task {
    return {
        id, status, summary: id, bodies: [], files: { read: [], edit: [] },
        created_at: '', updated_at: '', order,
    };
}

describe('saveTasks: order重複解消', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
    });

    it('2タスクが同一order値を持つ状態で、新しく設定されたタスクが優先される', () => {
        const tasks = [task('TASK-1', '1'), task('TASK-2', '1')];
        // TASK-2が今回新しく order=1 に設定された、という想定
        saveTasks(tasks, ['TASK-2']);

        const loaded = loadTasks();
        const t1 = loaded.find(t => t.id === 'TASK-1')!;
        const t2 = loaded.find(t => t.id === 'TASK-2')!;
        expect(t2.order).toBe('1');
        expect(t1.order).toBe('2');
    });

    it('recentlySetOrderIdsを渡さない場合、既存の重複はタスク配列の出現順で決定的に解消される', () => {
        const tasks = [task('TASK-1', '1'), task('TASK-2', '1')];
        saveTasks(tasks); // 第2引数省略

        const loaded = loadTasks();
        const t1 = loaded.find(t => t.id === 'TASK-1')!;
        const t2 = loaded.find(t => t.id === 'TASK-2')!;
        // 配列内で先に出現する方(TASK-1)が勝つ
        expect(t1.order).toBe('1');
        expect(t2.order).toBe('2');
    });

    it('同一コマンド内で複数タスクに同じ値を設定した場合、後から適用された方が勝つ', () => {
        const tasks = [task('TASK-1', '1'), task('TASK-2', '1')];
        // TASK-1 -> TASK-2 の順に適用された想定（末尾が最新）
        saveTasks(tasks, ['TASK-1', 'TASK-2']);
        let loaded = loadTasks();
        expect(loaded.find(t => t.id === 'TASK-2')!.order).toBe('1');
        expect(loaded.find(t => t.id === 'TASK-1')!.order).toBe('2');

        // 逆順で適用すればTASK-1が勝つ（IDではなく適用順であることの確認）
        const tasks2 = [task('TASK-1', '1'), task('TASK-2', '1')];
        saveTasks(tasks2, ['TASK-2', 'TASK-1']);
        loaded = loadTasks();
        expect(loaded.find(t => t.id === 'TASK-1')!.order).toBe('1');
        expect(loaded.find(t => t.id === 'TASK-2')!.order).toBe('2');
    });

    it('done等のステータスのタスクは重複解消の対象外で、orderはnullになる', () => {
        const tasks = [task('TASK-1', '1', 'done'), task('TASK-2', '1', 'todo')];
        saveTasks(tasks, ['TASK-2']);
        const loaded = loadTasks();
        expect(loaded.find(t => t.id === 'TASK-1')!.order).toBeNull();
        expect(loaded.find(t => t.id === 'TASK-2')!.order).toBe('1');
    });
});
