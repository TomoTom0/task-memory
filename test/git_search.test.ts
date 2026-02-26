import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from 'bun:test';
import { findGitPath, getDbPath } from '../src/store';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from 'fs';

mock.module('os', () => {
    return {
        homedir: () => '/tmp/fake-home'
    };
});

describe('findGitPath', () => {
    const root = '/tmp/fake-home';
    const project = join(root, 'project');
    const subdir = join(project, 'subdir');

    beforeAll(() => {
        try { mkdirSync(join(project, '.git'), { recursive: true }); } catch { }
        try { mkdirSync(subdir, { recursive: true }); } catch { }
    });

    it('should find .git in current directory', () => {
        const result = findGitPath(project);
        expect(result).toBe(join(project, '.git'));
    });

    it('should find .git in parent directory', () => {
        const result = findGitPath(subdir);
        expect(result).toBe(join(project, '.git'));
    });

    it('should stop at home directory and return null if no .git', () => {
        const result = findGitPath(root);
        expect(result).toBeNull();
    });

    it('should find .git even when it is a file', () => {
        const worktree = join(root, 'worktree-findgit');
        mkdirSync(worktree, { recursive: true });
        writeFileSync(join(worktree, '.git'), 'gitdir: /some/.git/worktrees/foo');

        const result = findGitPath(worktree);
        expect(result).toBe(join(worktree, '.git'));

        rmSync(worktree, { recursive: true, force: true });
    });
});

describe('getDbPath', () => {
    const root = '/tmp/fake-home';
    const dirProject = join(root, 'getdbpath-dir');   // .git がディレクトリ
    const fileProject = join(root, 'getdbpath-file'); // .git がファイル（worktree）
    let originalCwd: string;

    beforeAll(() => {
        originalCwd = process.cwd();
        mkdirSync(join(dirProject, '.git'), { recursive: true });
        mkdirSync(fileProject, { recursive: true });
        writeFileSync(join(fileProject, '.git'), 'gitdir: /some/.git/worktrees/foo');
    });

    afterAll(() => {
        process.chdir(originalCwd);
        rmSync(dirProject, { recursive: true, force: true });
        rmSync(fileProject, { recursive: true, force: true });
    });

    afterEach(() => {
        process.chdir(originalCwd);
    });

    // .git がディレクトリのケース

    it('.git がディレクトリ: .git/task-memory.json が存在する場合はそれを返す', () => {
        const path = join(dirProject, '.git', 'task-memory.json');
        writeFileSync(path, '{"tasks":[]}');
        process.chdir(dirProject);
        expect(getDbPath()).toBe(path);
        unlinkSync(path);
    });

    it('.git がディレクトリ: 同階層の task-memory.json が存在し .git/task-memory.json がない場合', () => {
        const path = join(dirProject, 'task-memory.json');
        writeFileSync(path, '{"tasks":[]}');
        process.chdir(dirProject);
        expect(getDbPath()).toBe(path);
        unlinkSync(path);
    });

    it('.git がディレクトリ: 同階層の .task-memory.json が存在し他がない場合', () => {
        const path = join(dirProject, '.task-memory.json');
        writeFileSync(path, '{"tasks":[]}');
        process.chdir(dirProject);
        expect(getDbPath()).toBe(path);
        unlinkSync(path);
    });

    it('.git がディレクトリ: .git/task-memory.json と同階層ファイルの両方がある場合は .git/task-memory.json を優先', () => {
        const gitPath = join(dirProject, '.git', 'task-memory.json');
        const sameLevelPath = join(dirProject, 'task-memory.json');
        writeFileSync(gitPath, '{"tasks":[]}');
        writeFileSync(sameLevelPath, '{"tasks":[]}');
        process.chdir(dirProject);
        expect(getDbPath()).toBe(gitPath);
        unlinkSync(gitPath);
        unlinkSync(sameLevelPath);
    });

    it('.git がディレクトリ: ファイルが存在しない場合は .git/task-memory.json をデフォルトとする', () => {
        process.chdir(dirProject);
        expect(getDbPath()).toBe(join(dirProject, '.git', 'task-memory.json'));
    });

    // .git がファイル（worktree）のケース

    it('.git がファイル: 同階層の task-memory.json が存在する場合はそれを返す', () => {
        const path = join(fileProject, 'task-memory.json');
        writeFileSync(path, '{"tasks":[]}');
        process.chdir(fileProject);
        expect(getDbPath()).toBe(path);
        unlinkSync(path);
    });

    it('.git がファイル: 同階層の .task-memory.json が存在する場合はそれを返す', () => {
        const path = join(fileProject, '.task-memory.json');
        writeFileSync(path, '{"tasks":[]}');
        process.chdir(fileProject);
        expect(getDbPath()).toBe(path);
        unlinkSync(path);
    });

    it('.git がファイル: task-memory.json が .task-memory.json より優先される', () => {
        const taskMemory = join(fileProject, 'task-memory.json');
        const hiddenTaskMemory = join(fileProject, '.task-memory.json');
        writeFileSync(taskMemory, '{"tasks":[]}');
        writeFileSync(hiddenTaskMemory, '{"tasks":[]}');
        process.chdir(fileProject);
        expect(getDbPath()).toBe(taskMemory);
        unlinkSync(taskMemory);
        unlinkSync(hiddenTaskMemory);
    });

    it('.git がファイル: ファイルが存在しない場合は同階層の task-memory.json をデフォルトとする', () => {
        process.chdir(fileProject);
        expect(getDbPath()).toBe(join(fileProject, 'task-memory.json'));
    });
});
