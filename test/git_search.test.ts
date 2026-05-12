import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { findGitDir } from '../src/store';
import { join } from 'path';
import { mkdirSync, rmdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';

// Mock homedir
// Bun test mocking of os module might be tricky, but let's try to verify logic by structure.
// If we can't mock homedir easily, we can rely on the fact that we are running in a specific environment.
// But we can verify the logic by creating a fake root structure in a temp dir and pretending one of them is home?
// No, findGitDir calls real homedir().

// Let's try to mock os.homedir
mock.module('os', () => {
    return {
        homedir: () => '/tmp/fake-home'
    };
});

describe('findGitDir', () => {
    const root = '/tmp/fake-home';
    const project = join(root, 'project');
    const subdir = join(project, 'subdir');
    const outside = '/tmp/outside';

    beforeAll(() => {
        // Setup directory structure
        // /tmp/fake-home/.git (Simulate home git - optional, let's say none for now)
        // /tmp/fake-home/project/.git
        // /tmp/fake-home/project/subdir

        try { mkdirSync(root, { recursive: true }); } catch { }
        try { mkdirSync(join(project, '.git'), { recursive: true }); } catch { }
        try { mkdirSync(subdir, { recursive: true }); } catch { }
        try { mkdirSync(outside, { recursive: true }); } catch { }
    });

    afterAll(() => {
        // Cleanup
        // rm -rf /tmp/fake-home
        // rm -rf /tmp/outside
    });

    it('should find .git in current directory', () => {
        const result = findGitDir(project);
        expect(result).toBe(join(project, '.git'));
    });

    it('should find .git in parent directory', () => {
        const result = findGitDir(subdir);
        expect(result).toBe(join(project, '.git'));
    });

    it('should stop at home directory', () => {
        // If we are at home, and home has no .git, it should return null
        // And NOT check /tmp/.git or /.git

        // Ensure home has no .git
        // (We didn't create it)

        const result = findGitDir(root);
        expect(result).toBeNull();
    });

    it('should find .git in home directory if it exists', () => {
        const homeGit = join(root, '.git');
        try { mkdirSync(homeGit, { recursive: true }); } catch { }

        const result = findGitDir(root);
        expect(result).toBe(homeGit);

        // Cleanup
        try { rmdirSync(homeGit); } catch { }
    });
});
