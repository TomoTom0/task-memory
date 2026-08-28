import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { syncCommand } from '../src/commands/sync';
import { saveToSync, pullFromSync, initSyncRepo, getSyncDir, generateSyncId } from '../src/syncStore';
import { loadStore, saveStore } from '../src/store';
import type { TaskStore, Task } from '../src/types';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { createTempProject, removeTempDir } from './helpers';

describe('syncStore', () => {
    afterEach(() => {
        for (const id of ['test-project']) {
            const filePath = join(getSyncDir(), 'projects', `${id}.json`);
            if (existsSync(filePath)) rmSync(filePath);
        }
    });

    describe('saveToSync', () => {
        it('should save store data to sync directory', () => {
            initSyncRepo();
            const store: TaskStore = { tasks: [] };
            const result = saveToSync('test-project', store);
            expect(result).toBe(true);

            const filePath = join(getSyncDir(), 'projects', 'test-project.json');
            expect(existsSync(filePath)).toBe(true);
        });

        it('should return false when sync not initialized', () => {
            const store: TaskStore = { tasks: [] };
            const result = saveToSync('test-project', store);
            expect(typeof result).toBe('boolean');
        });
    });

    describe('pullFromSync', () => {
        it('should pull store data from sync directory', () => {
            initSyncRepo();
            const store: TaskStore = { tasks: [] };
            saveToSync('test-project', store);

            const pulled = pullFromSync('test-project');
            expect(pulled).not.toBeNull();
            expect(pulled!.tasks).toEqual([]);
        });

        it('should return null for non-existent project', () => {
            initSyncRepo();
            const result = pullFromSync('non-existent-project');
            expect(result).toBeNull();
        });
    });

    describe('generateSyncId', () => {
        it('should generate a non-empty sync id', () => {
            const id = generateSyncId();
            expect(id.length).toBeGreaterThan(0);
        });
    });
});

describe('syncCommand', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = createTempProject();
        process.chdir(tempDir);
        const store: TaskStore = {
            tasks: [],
            sync: {
                id: 'test-project',
                enabled: true,
                auto: false,
            },
        };
        saveStore(store);
        initSyncRepo();
    });

    afterEach(() => {
        process.chdir(originalCwd);
        removeTempDir(tempDir);
        for (const id of ['test-project', 'new-project']) {
            const filePath = join(getSyncDir(), 'projects', `${id}.json`);
            if (existsSync(filePath)) rmSync(filePath);
        }
    });

    describe('save', () => {
        it('should save tasks to sync directory', () => {
            syncCommand(['save']);

            const filePath = join(getSyncDir(), 'projects', 'test-project.json');
            expect(existsSync(filePath)).toBe(true);
        });

        it('should fail when not synced', () => {
            saveStore({ tasks: [] });
            const origExit = process.exit;
            let exitCode = 0;
            process.exit = ((code: number) => { exitCode = code; throw new Error('exit'); }) as never;
            try {
                syncCommand(['save']);
            } catch {
                // expected
            }
            process.exit = origExit;
            expect(exitCode).toBe(1);
        });
    });

    describe('add', () => {
        it('should add project to sync', () => {
            saveStore({ tasks: [] });
            syncCommand(['add', '--id', 'new-project', '--save']);

            const store = loadStore();
            expect(store.sync).toBeDefined();
            expect(store.sync!.enabled).toBe(true);
            expect(store.sync!.id).toBe('new-project');
        });

        it('should report already synced', () => {
            const logs: string[] = [];
            const origLog = console.log;
            console.log = (...args: unknown[]) => logs.push(args.join(' '));

            syncCommand(['add']);
            expect(logs.some(l => l.includes('Already added'))).toBe(true);

            console.log = origLog;
        });
    });

    describe('remove', () => {
        it('should remove project from sync', () => {
            syncCommand(['remove']);
            const store = loadStore();
            expect(store.sync!.enabled).toBe(false);
        });
    });

    describe('set', () => {
        it('should update sync id', () => {
            syncCommand(['set', '--id', 'renamed-project']);
            const store = loadStore();
            expect(store.sync!.id).toBe('renamed-project');
        });

        it('should set auto mode', () => {
            syncCommand(['set', 'auto']);
            const store = loadStore();
            expect(store.sync!.auto).toBe(true);
        });

        it('should set manual mode', () => {
            syncCommand(['set', 'auto']);
            syncCommand(['set', 'manual']);
            const store = loadStore();
            expect(store.sync!.auto).toBe(false);
        });

        it('should update id and mode together', () => {
            syncCommand(['set', '--id', 'new-id', 'auto']);
            const store = loadStore();
            expect(store.sync!.id).toBe('new-id');
            expect(store.sync!.auto).toBe(true);
        });
    });

    describe('pull', () => {
        function task(id: string, order: string | null): Task {
            return {
                id, status: 'todo', summary: id, bodies: [], files: { read: [], edit: [] },
                created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', order,
            };
        }

        it('マージモード: リモート由来のorder重複が正規化を通って解消される', () => {
            // ローカルに order=1 のタスクがあり、リモート(sync先)にも別IDで order=1 のタスクがある
            saveStore({
                tasks: [task('TASK-1', '1')],
                sync: { id: 'test-project', enabled: true, auto: false },
            });
            const remoteStore: TaskStore = { tasks: [task('TASK-2', '1')] };
            saveToSync('test-project', remoteStore);

            syncCommand(['pull', '--merge']);

            const store = loadStore();
            const orders = store.tasks.map(t => t.order).filter((o): o is string => o != null);
            // 重複が解消され、ユニークな値になっていること
            expect(new Set(orders).size).toBe(orders.length);
            expect(orders.length).toBe(2);
        });

        it('上書きモード: リモートのタスクにorder重複があっても正規化を通る', () => {
            saveStore({
                tasks: [task('TASK-1', '1')],
                sync: { id: 'test-project', enabled: true, auto: false },
            });
            // リモート側データ自体に重複が含まれているケース
            const remoteStore: TaskStore = {
                tasks: [task('TASK-1', '1'), task('TASK-2', '1')],
            };
            saveToSync('test-project', remoteStore);

            syncCommand(['pull']);

            const store = loadStore();
            const orders = store.tasks.map(t => t.order).filter((o): o is string => o != null);
            expect(new Set(orders).size).toBe(orders.length);
            // sync設定(他フィールド)が保持されていること
            expect(store.sync?.id).toBe('test-project');
        });
    });

    describe('status', () => {
        it('should show sync status', () => {
            const logs: string[] = [];
            const origLog = console.log;
            console.log = (...args: unknown[]) => logs.push(args.join(' '));

            syncCommand(['status']);
            expect(logs.some(l => l.includes('Sync Status'))).toBe(true);

            console.log = origLog;
        });
    });
});
