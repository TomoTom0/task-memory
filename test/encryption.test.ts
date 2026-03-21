import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
    generateAgeKey,
    getPublicKeyFromIdentityFile,
    encryptData,
    decryptData,
    pushToSync,
    pullFromSync,
    getEncryptedProjectFilePath,
    getProjectFilePath,
} from '../src/syncStore';
import type { TaskStore } from '../src/types';

const TMP_DIR = join(import.meta.dir, '..', 'tmp', 'encryption-test');
const KEY_FILE = join(TMP_DIR, 'test.key');

// syncStore の SYNC_DIR/PROJECTS_DIR はモジュールレベル定数なので
// 統合テストではなく、暗号化関数単体をテストする
describe('generateAgeKey', () => {
    beforeAll(() => {
        mkdirSync(TMP_DIR, { recursive: true });
    });

    afterAll(() => {
        rmSync(TMP_DIR, { recursive: true, force: true });
    });

    it('age identity ファイルを生成できる', () => {
        const ok = generateAgeKey(KEY_FILE);
        expect(ok).toBe(true);
        expect(existsSync(KEY_FILE)).toBe(true);
    });

    it('生成した identity ファイルから公開鍵を取得できる', () => {
        const pubkey = getPublicKeyFromIdentityFile(KEY_FILE);
        expect(pubkey).not.toBeNull();
        expect(pubkey).toMatch(/^age1/);
    });

    it('存在しない identity ファイルの場合は null を返す', () => {
        const pubkey = getPublicKeyFromIdentityFile('/nonexistent/path.key');
        expect(pubkey).toBeNull();
    });
});

describe('encryptData / decryptData', () => {
    beforeAll(() => {
        mkdirSync(TMP_DIR, { recursive: true });
        generateAgeKey(KEY_FILE);
    });

    afterAll(() => {
        rmSync(TMP_DIR, { recursive: true, force: true });
    });

    it('データを暗号化して復号できる', () => {
        const pubkey = getPublicKeyFromIdentityFile(KEY_FILE)!;
        const original = JSON.stringify({ hello: 'world', tasks: [] });
        const encrypted = encryptData(original, pubkey);
        expect(encrypted).not.toBeNull();
        expect(encrypted).not.toBe(original);

        const decrypted = decryptData(encrypted!, KEY_FILE);
        expect(decrypted?.trim()).toBe(original);
    });

    it('暗号化データは ASCII armor 形式', () => {
        const pubkey = getPublicKeyFromIdentityFile(KEY_FILE)!;
        const encrypted = encryptData('test', pubkey);
        expect(encrypted).toMatch(/-----BEGIN AGE ENCRYPTED FILE-----/);
    });

    it('異なる鍵では復号できない', () => {
        const otherKey = join(TMP_DIR, 'other.key');
        generateAgeKey(otherKey);

        const pubkey = getPublicKeyFromIdentityFile(KEY_FILE)!;
        const encrypted = encryptData('secret data', pubkey);
        const decrypted = decryptData(encrypted!, otherKey);
        expect(decrypted).toBeNull();
    });
});
