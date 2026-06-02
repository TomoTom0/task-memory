import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';

describe('global mode', () => {
    const origArgv = process.argv;
    const origCwd = process.cwd;
    const origEnv = process.env;

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
        it('should throw NotGitError when not in git repo without --global', async () => {
            // Use /tmp which is unlikely to be in a git repo
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { getDbPath, NotGitError } = await import('../src/store');
            expect(() => getDbPath()).toThrow(NotGitError);
            expect(() => getDbPath()).toThrow(/--global/);
        });

        it('should return home path when --global is set and not in git repo', async () => {
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { getDbPath, setGlobalMode } = await import('../src/store');
            setGlobalMode(true);
            const result = getDbPath();
            expect(result).toBe(join(homedir(), '.task-memory.json'));
        });

        it('should return home path when --global is set even in git repo', async () => {
            const tmpDir = join('/tmp', 'tm-test-git-' + Date.now());
            mkdirSync(join(tmpDir, '.git'), { recursive: true });
            Object.defineProperty(process, 'cwd', {
                value: () => tmpDir,
                configurable: true,
            });

            const { getDbPath, setGlobalMode } = await import('../src/store');
            setGlobalMode(true);
            const result = getDbPath();
            expect(result).toBe(join(homedir(), '.task-memory.json'));

            try { rmSync(tmpDir, { recursive: true }); } catch { }
        });
    });

    describe('getReviewDbPath', () => {
        it('should throw NotGitError when not in git repo without --global', async () => {
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { getReviewDbPath } = await import('../src/reviewStore');
            const { NotGitError } = await import('../src/store');
            expect(() => getReviewDbPath()).toThrow(NotGitError);
        });

        it('should return home path when --global is set and not in git repo', async () => {
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { setGlobalMode } = await import('../src/store');
            setGlobalMode(true);

            const { getReviewDbPath } = await import('../src/reviewStore');
            const result = getReviewDbPath();
            expect(result).toBe(join(homedir(), '.review-memory.json'));
        });
    });

    describe('--global flag parsing', () => {
        it('should parse --global flag and set global mode', async () => {
            const tmpDir = join('/tmp', 'tm-test-global-flag-' + Date.now());
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

            try { rmSync(tmpDir, { recursive: true }); } catch { }
        });
    });

    describe('CODING_AGENT_ROOT', () => {
        it('should use CODING_AGENT_ROOT/.git when env var is set', async () => {
            const agentRoot = join('/tmp', 'tm-agent-root-' + Date.now());
            mkdirSync(join(agentRoot, '.git'), { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            // cwd is non-git, but CODING_AGENT_ROOT overrides it
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(agentRoot, '.git', 'task-memory.json'));

            try { rmSync(agentRoot, { recursive: true }); } catch { }
        });

        it('should throw NotGitError when CODING_AGENT_ROOT has no .git', async () => {
            const agentRoot = join('/tmp', 'tm-agent-root-nogit-' + Date.now());
            mkdirSync(agentRoot, { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            Object.defineProperty(process, 'cwd', {
                value: () => '/tmp/tm-test-nongit-' + Date.now(),
                configurable: true,
            });

            const { getDbPath, NotGitError } = await import('../src/store');
            expect(() => getDbPath()).toThrow(NotGitError);

            try { rmSync(agentRoot, { recursive: true }); } catch { }
        });

        it('should use CODING_AGENT_ROOT over cwd when both have .git', async () => {
            const agentRoot = join('/tmp', 'tm-agent-root-priority-' + Date.now());
            const cwdDir = join('/tmp', 'tm-cwd-root-priority-' + Date.now());
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

            try { rmSync(agentRoot, { recursive: true }); } catch { }
            try { rmSync(cwdDir, { recursive: true }); } catch { }
        });

        it('should fall back to cwd when CODING_AGENT_ROOT is not set', async () => {
            delete process.env.CODING_AGENT_ROOT;
            const cwdDir = join('/tmp', 'tm-cwd-fallback-' + Date.now());
            mkdirSync(join(cwdDir, '.git'), { recursive: true });

            Object.defineProperty(process, 'cwd', {
                value: () => cwdDir,
                configurable: true,
            });

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(cwdDir, '.git', 'task-memory.json'));

            try { rmSync(cwdDir, { recursive: true }); } catch { }
        });
    });
});
