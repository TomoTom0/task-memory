import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';

const TMP_ROOT = join(process.cwd(), 'tmp');

export function createTempProject(): string {
    const dir = join(TMP_ROOT, `test-${Date.now()}-${randomUUID().slice(0, 10)}`);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, '.git'), { recursive: true });
    return dir;
}

export function removeTempDir(dir: string): void {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
