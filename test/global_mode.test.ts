import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

describe('global mode', () => {
    const origArgv = process.argv;
    const origCwd = process.cwd;
    const origEnv = process.env;
    // findGitPathの遡上はhomeで停止するため、sandbox home直下のパスは
    // sandbox外の.gitの影響を受けず確実に非gitになる
    const homeIsGitRepo = existsSync(join(homedir(), '.git'));

    function useNonGitCwd(): void {
        // findGitPathはexistsSyncの存在チェックのみでcwdの実在を要求しないため、
        // 実在しないパスでよい。sandbox home直下（setup.tsが作成済み）を指す
        const sandbox = join(homedir(), '.tm-test-nongit-' + Date.now());
        Object.defineProperty(process, 'cwd', {
            value: () => sandbox,
            configurable: true,
        });
    }

    beforeEach(async () => {
        process.argv = [...origArgv];
        vi.resetModules();
    });

    afterEach(() => {
        process.argv = origArgv;
        Object.defineProperty(process, 'cwd', { value: origCwd, configurable: true });
        process.env = { ...origEnv };
    });

    describe('getDbPath', () => {
        it.skipIf(homeIsGitRepo)('should throw NotGitError when not in git repo without --global', async () => {
            useNonGitCwd();

            const { getDbPath, NotGitError } = await import('../src/store');
            expect(() => getDbPath()).toThrow(NotGitError);
            expect(() => getDbPath()).toThrow(/--global/);
        });

        it('should return home path when --global is set and not in git repo', async () => {
            useNonGitCwd();

            const { getDbPath, setGlobalMode } = await import('../src/store');
            setGlobalMode(true);
            const result = getDbPath();
            expect(result).toBe(join(homedir(), '.task-memory.json'));
        });

        it('should return home path when --global is set even in git repo', async () => {
            const tmpDir = join(homedir(), 'work', 'tm-test-git-' + Date.now());
            mkdirSync(join(tmpDir, '.git'), { recursive: true });
            Object.defineProperty(process, 'cwd', {
                value: () => tmpDir,
                configurable: true,
            });

            const { getDbPath, setGlobalMode } = await import('../src/store');
            setGlobalMode(true);
            const result = getDbPath();
            expect(result).toBe(join(homedir(), '.task-memory.json'));
        });
    });

    describe('getReviewDbPath', () => {
        it.skipIf(homeIsGitRepo)('should throw NotGitError when not in git repo without --global', async () => {
            useNonGitCwd();

            const { getReviewDbPath } = await import('../src/reviewStore');
            const { NotGitError } = await import('../src/store');
            expect(() => getReviewDbPath()).toThrow(NotGitError);
        });

        it('should return home path when --global is set and not in git repo', async () => {
            useNonGitCwd();

            const { setGlobalMode } = await import('../src/store');
            setGlobalMode(true);

            const { getReviewDbPath } = await import('../src/reviewStore');
            const result = getReviewDbPath();
            expect(result).toBe(join(homedir(), '.review-memory.json'));
        });
    });

    describe('--global flag parsing', () => {
        it('should parse --global flag and set global mode', async () => {
            const tmpDir = join(homedir(), 'work', 'tm-test-global-flag-' + Date.now());
            mkdirSync(tmpDir, { recursive: true });
            Object.defineProperty(process, 'cwd', {
                value: () => tmpDir,
                configurable: true,
            });

            process.argv = ['node', 'tm', '--global', 'env'];

            const { setGlobalMode, getDbPath } = await import('../src/store');

            setGlobalMode(true);
            const result = getDbPath();
            expect(result).toBe(join(homedir(), '.task-memory.json'));
        });
    });

    describe('CODING_AGENT_ROOT', () => {
        it('should use CODING_AGENT_ROOT/.git when env var is set', async () => {
            const agentRoot = join(homedir(), 'work', 'tm-agent-root-' + Date.now());
            mkdirSync(join(agentRoot, '.git'), { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            // cwd is non-git, but CODING_AGENT_ROOT overrides it
            useNonGitCwd();

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(agentRoot, '.git', 'task-memory.json'));
        });

        it('should throw NotGitError when CODING_AGENT_ROOT has no .git', async () => {
            const agentRoot = join(homedir(), 'work', 'tm-agent-root-nogit-' + Date.now());
            mkdirSync(agentRoot, { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            useNonGitCwd();

            const { getDbPath, NotGitError } = await import('../src/store');
            expect(() => getDbPath()).toThrow(NotGitError);
        });

        it('should use CODING_AGENT_ROOT over cwd when both have .git', async () => {
            const agentRoot = join(homedir(), 'work', 'tm-agent-root-priority-' + Date.now());
            const cwdDir = join(homedir(), 'work', 'tm-cwd-root-priority-' + Date.now());
            mkdirSync(join(agentRoot, '.git'), { recursive: true });
            mkdirSync(join(cwdDir, '.git'), { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            Object.defineProperty(process, 'cwd', {
                value: () => cwdDir,
                configurable: true,
            });

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(agentRoot, '.git', 'task-memory.json'));
        });

        it('should fall back to cwd when CODING_AGENT_ROOT is not set', async () => {
            delete process.env.CODING_AGENT_ROOT;
            const cwdDir = join(homedir(), 'work', 'tm-cwd-fallback-' + Date.now());
            mkdirSync(join(cwdDir, '.git'), { recursive: true });

            Object.defineProperty(process, 'cwd', {
                value: () => cwdDir,
                configurable: true,
            });

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(cwdDir, '.git', 'task-memory.json'));
        });
    });
});
