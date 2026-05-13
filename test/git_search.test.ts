import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmdirSync } from 'fs';

vi.mock('os', () => ({
    homedir: () => '/tmp/fake-home',
    default: { homedir: () => '/tmp/fake-home' },
}));

describe('findGitPath', () => {
    const root = '/tmp/fake-home';
    const project = join(root, 'project');
    const subdir = join(project, 'subdir');

    beforeAll(() => {
        try { mkdirSync(root, { recursive: true }); } catch { }
        try { mkdirSync(join(project, '.git'), { recursive: true }); } catch { }
        try { mkdirSync(subdir, { recursive: true }); } catch { }
    });

    afterAll(() => {
        // intentionally not cleaning up /tmp/fake-home to avoid rm -rf /tmp
    });

    it('should find .git in current directory', async () => {
        const { findGitPath } = await import('../src/store');
        const result = findGitPath(project);
        expect(result).toBe(join(project, '.git'));
    });

    it('should find .git in parent directory', async () => {
        const { findGitPath } = await import('../src/store');
        const result = findGitPath(subdir);
        expect(result).toBe(join(project, '.git'));
    });

    it('should stop at home directory', async () => {
        const { findGitPath } = await import('../src/store');
        const result = findGitPath(root);
        expect(result).toBeNull();
    });

    it('should find .git in home directory if it exists', async () => {
        const { findGitPath } = await import('../src/store');
        const homeGit = join(root, '.git');
        try { mkdirSync(homeGit, { recursive: true }); } catch { }
        const result = findGitPath(root);
        expect(result).toBe(homeGit);
        try { rmdirSync(homeGit); } catch { }
    });
});
