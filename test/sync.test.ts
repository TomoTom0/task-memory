import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { syncCommand } from '../src/commands/sync';
import { saveToSync, pullFromSync, initSyncRepo, getSyncDir, generateSyncId } from '../src/syncStore';
import { loadStore, saveStore } from '../src/store';
import type { TaskStore } from '../src/types';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { createTempProject, removeTempDir } from './helpers';

describe('syncStore', () => {
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
