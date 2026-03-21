import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const PROJECT_ROOT = join(import.meta.dir, '..', '..');

export interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * 一時的なgitリポジトリを tmp/ 以下に作成する。
 * 返したパスは afterAll で cleanup() を呼んで削除すること。
 */
export function createTestProject(): string {
    const tmpDir = join(PROJECT_ROOT, 'tmp', `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpDir, '.git'), { recursive: true });
    return tmpDir;
}

export function cleanup(projectDir: string): void {
    rmSync(projectDir, { recursive: true, force: true });
}

/**
 * tm コマンドをサブプロセスとして実行する。
 * cwd は testProject のディレクトリなので、DB_PATH はそこの .git/task-memory.json になる。
 */
export function runTm(args: string[], projectDir: string): RunResult {
    const result = spawnSync(
        'bun',
        [join(PROJECT_ROOT, 'src', 'index.ts'), ...args],
        {
            cwd: projectDir,
            encoding: 'utf-8',
        }
    );

    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.status ?? 0,
    };
}
