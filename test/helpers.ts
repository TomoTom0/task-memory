import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

// sandboxのwork領域（setup.tsが home/work/project を作成済みであるため必ず実在する）
export function getSandboxWorkDir(): string {
    return join(homedir(), 'work');
}

export function createTempProject(): string {
    const dir = join(getSandboxWorkDir(), `test-${Date.now()}-${randomUUID().slice(0, 10)}`);
    mkdirSync(join(dir, '.git'), { recursive: true });
    return dir;
}

export function removeTempDir(dir: string): void {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
