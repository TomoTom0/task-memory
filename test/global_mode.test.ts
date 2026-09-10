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

        it('should fall back to cwd when CODING_AGENT_ROOT is an empty string', async () => {
            // 空文字列は未設定として扱い、cwd基準の探索へフォールバックする
            process.env.CODING_AGENT_ROOT = '';
            const cwdDir = join(homedir(), 'work', 'tm-cwd-empty-' + Date.now());
            mkdirSync(join(cwdDir, '.git'), { recursive: true });

            Object.defineProperty(process, 'cwd', {
                value: () => cwdDir,
                configurable: true,
            });

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(cwdDir, '.git', 'task-memory.json'));
        });

        it('should ascend to parent .git when CODING_AGENT_ROOT is a monorepo subdirectory', async () => {
            // agentRoot直下には.gitが無く、repoルートにのみあるmonorepo構成
            const repoRoot = join(homedir(), 'work', 'tm-agent-monorepo-' + Date.now());
            const agentRoot = join(repoRoot, 'packages', 'sub');
            mkdirSync(join(repoRoot, '.git'), { recursive: true });
            mkdirSync(agentRoot, { recursive: true });

            process.env.CODING_AGENT_ROOT = agentRoot;
            // cwdは非gitのため、解決はagentRootからの遡上のみに依存する
            useNonGitCwd();

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(repoRoot, '.git', 'task-memory.json'));

            // reviewStoreも同一のresolveGitPathを経由するため同様に遡上する
            const { getReviewDbPath } = await import('../src/reviewStore');
            expect(getReviewDbPath()).toBe(join(repoRoot, '.git', 'review-memory.json'));
        });

        it('should resolve relative CODING_AGENT_ROOT against cwd', async () => {
            // resolve()はprocess.cwd()基準で相対パスを絶対化するため、
            // cwdモック先をrepoルートとし、その配下にpackages/subを配置して整合させる
            const repoRoot = join(homedir(), 'work', 'tm-agent-relative-' + Date.now());
            mkdirSync(join(repoRoot, '.git'), { recursive: true });
            mkdirSync(join(repoRoot, 'packages', 'sub'), { recursive: true });

            Object.defineProperty(process, 'cwd', {
                value: () => repoRoot,
                configurable: true,
            });

            process.env.CODING_AGENT_ROOT = 'packages/sub';

            const { getDbPath } = await import('../src/store');
            const result = getDbPath();
            expect(result).toBe(join(repoRoot, '.git', 'task-memory.json'));
        });

        it('should throw NotGitError when CODING_AGENT_ROOT does not exist', async () => {
            // 祖先に.gitがあるため、existsSyncガードが無ければ
            // findGitPathの遡上で祖先.gitへ誤解決するfixture
            const parentDir = join(homedir(), 'work', 'tm-agent-nonexist-' + Date.now());
            mkdirSync(join(parentDir, '.git'), { recursive: true });
            const agentRoot = join(parentDir, 'no-such-dir');

            process.env.CODING_AGENT_ROOT = agentRoot;
            useNonGitCwd();

            const { getDbPath, NotGitError } = await import('../src/store');
            expect(() => getDbPath()).toThrow(NotGitError);
        });
    });
});
