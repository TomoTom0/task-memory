import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, rmdirSync } from 'fs';

describe('findGitPath', () => {
    // sandbox HOME配下のwork領域にfixtureを作る（homedir()はsetup.tsによりsandbox HOME）
    const root = join(homedir(), 'work', `git-search-${Date.now()}`);
    const project = join(root, 'project');
    const subdir = join(project, 'subdir');

    beforeAll(() => {
        mkdirSync(join(project, '.git'), { recursive: true });
        mkdirSync(subdir, { recursive: true });
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
