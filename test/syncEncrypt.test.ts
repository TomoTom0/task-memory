import { describe, it, expect } from 'bun:test';
import { resolveEncryptSettings } from '../src/commands/sync';
import type { SyncConfig } from '../src/types';

function makeSyncConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
    return {
        id: 'test-project',
        enabled: true,
        auto: false,
        ...overrides,
    };
}

describe('resolveEncryptSettings', () => {
    describe('暗号化の有効/無効', () => {
        it('デフォルトは無効', () => {
            const result = resolveEncryptSettings(makeSyncConfig(), {});
            expect(result.enabled).toBe(false);
            expect(result.recipient).toBeUndefined();
            expect(result.identityFile).toBeUndefined();
        });

        it('プロジェクト設定で有効化できる', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true }),
                {}
            );
            expect(result.enabled).toBe(true);
        });

        it('グローバル設定で有効化できる', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig(),
                { defaultEncryptEnabled: true }
            );
            expect(result.enabled).toBe(true);
        });

        it('プロジェクト設定がグローバル設定より優先される（on > off）', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true }),
                { defaultEncryptEnabled: false }
            );
            expect(result.enabled).toBe(true);
        });

        it('プロジェクト設定がグローバル設定より優先される（off > on）', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: false }),
                { defaultEncryptEnabled: true }
            );
            expect(result.enabled).toBe(false);
        });
    });

    describe('recipient（公開鍵）の解決', () => {
        it('暗号化無効のときrecipientはundefined', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptRecipient: 'age1xxx' }),
                {}
            );
            expect(result.recipient).toBeUndefined();
        });

        it('プロジェクトのrecipientを使う', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true, encryptRecipient: 'age1project' }),
                { defaultEncryptRecipient: 'age1global' }
            );
            expect(result.recipient).toBe('age1project');
        });

        it('プロジェクト未設定ならグローバルのrecipientにフォールバック', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true }),
                { defaultEncryptRecipient: 'age1global' }
            );
            expect(result.recipient).toBe('age1global');
        });
    });

    describe('identityFile（秘密鍵）の解決', () => {
        it('暗号化無効のときidentityFileはundefined', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptIdentityFile: '/path/to/key' }),
                {}
            );
            expect(result.identityFile).toBeUndefined();
        });

        it('プロジェクトのidentityFileを使う', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true, encryptIdentityFile: '/project/key' }),
                { defaultEncryptIdentityFile: '/global/key' }
            );
            expect(result.identityFile).toBe('/project/key');
        });

        it('プロジェクト未設定ならグローバルのidentityFileにフォールバック', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true }),
                { defaultEncryptIdentityFile: '/global/key' }
            );
            expect(result.identityFile).toBe('/global/key');
        });
    });

    describe('典型的なユースケース', () => {
        it('グローバルに鍵を設定してプロジェクトで有効化', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: true }),
                {
                    defaultEncryptIdentityFile: '~/.local/task-memory/age.key',
                    defaultEncryptRecipient: 'age1global',
                }
            );
            expect(result.enabled).toBe(true);
            expect(result.identityFile).toBe('~/.local/task-memory/age.key');
            expect(result.recipient).toBe('age1global');
        });

        it('グローバルに鍵と有効化を設定し、特定プロジェクトだけ無効化', () => {
            const result = resolveEncryptSettings(
                makeSyncConfig({ encryptEnabled: false }),
                {
                    defaultEncryptEnabled: true,
                    defaultEncryptIdentityFile: '~/.local/task-memory/age.key',
                    defaultEncryptRecipient: 'age1global',
                }
            );
            expect(result.enabled).toBe(false);
            expect(result.recipient).toBeUndefined();
            expect(result.identityFile).toBeUndefined();
        });
    });
});
