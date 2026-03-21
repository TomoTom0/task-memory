import { describe, it, expect } from 'bun:test';
import { normalizeRemoteUrl } from '../src/syncStore';

describe('normalizeRemoteUrl', () => {
    it('HTTPS URL (.git あり)', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com-user-repo');
    });

    it('HTTPS URL (.git なし)', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo')).toBe('github.com-user-repo');
    });

    it('SSH URL (git@ 形式)', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo.git')).toBe('github.com-user-repo');
    });

    it('SSH URL (git@ 形式、.git なし)', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo')).toBe('github.com-user-repo');
    });

    it('GitLab SSH URL', () => {
        expect(normalizeRemoteUrl('git@gitlab.com:org/suborg/repo.git')).toBe('gitlab.com-org-suborg-repo');
    });

    it('GitLab HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://gitlab.com/org/suborg/repo.git')).toBe('gitlab.com-org-suborg-repo');
    });

    it('末尾の改行を無視する', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git\n')).toBe('github.com-user-repo');
    });
});
