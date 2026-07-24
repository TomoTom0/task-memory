import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isMainEntry } from '../src/index';
import { writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createTempProject, removeTempDir } from './helpers';

describe('isMainEntry (symlink-aware direct invocation check)', () => {
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

    it('returns true when argv points directly to the module file', () => {
        const real = join(tempDir, 'index.js');
        writeFileSync(real, '');
        expect(isMainEntry(real, pathToFileURL(real).href)).toBe(true);
    });

    it('returns true when argv is a symlink resolving to the module file', () => {
        const real = join(tempDir, 'index.js');
        const link = join(tempDir, 'tm');
        writeFileSync(real, '');
        // symlink 経由実行: process.argv[1] はリンク、import.meta.url は実パス
        symlinkSync(real, link);
        expect(isMainEntry(link, pathToFileURL(real).href)).toBe(true);
    });

    it('returns false when argv points to a different file', () => {
        const real = join(tempDir, 'index.js');
        const other = join(tempDir, 'other.js');
        writeFileSync(real, '');
        writeFileSync(other, '');
        expect(isMainEntry(other, pathToFileURL(real).href)).toBe(false);
    });

    it('returns false when argv1 is undefined', () => {
        const real = join(tempDir, 'index.js');
        writeFileSync(real, '');
        expect(isMainEntry(undefined, pathToFileURL(real).href)).toBe(false);
    });

    it('returns false when the module path does not exist', () => {
        const real = join(tempDir, 'index.js');
        writeFileSync(real, '');
        expect(isMainEntry(real, pathToFileURL(join(tempDir, 'missing.js')).href)).toBe(false);
    });
});
