import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { docsCommand } from '../src/commands/docs';

describe('tm docs command', () => {
    const originalExit = process.exit;

    beforeEach(() => {
        process.exit = vi.fn() as never;
    });

    afterEach(() => {
        process.exit = originalExit;
        vi.restoreAllMocks();
    });

    it('should show usage docs by default', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        docsCommand([]);
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0] as string;
        expect(output).toContain('tm');
        spy.mockRestore();
    });

    it('should show usage docs with explicit page name', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        docsCommand(['usage']);
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0] as string;
        expect(output).toContain('ユーザーガイド');
        spy.mockRestore();
    });

    it('should show agent-claude-md docs', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        docsCommand(['agent-claude-md']);
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0] as string;
        expect(output).toContain('タスク管理');
        spy.mockRestore();
    });

    it('should show agent-guide docs', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        docsCommand(['agent-guide']);
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0] as string;
        expect(output).toContain('coding agent');
        spy.mockRestore();
    });

    it('should show help with --help flag', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        docsCommand(['--help']);
        expect(spy).toHaveBeenCalled();
        const output = spy.mock.calls[0][0] as string;
        expect(output).toContain('Usage: tm docs');
        spy.mockRestore();
    });

    it('should error on unknown page', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        docsCommand(['nonexistent']);
        expect(errorSpy).toHaveBeenCalledWith("Error: Unknown docs page 'nonexistent'.");
        expect(process.exit).toHaveBeenCalledWith(1);
        errorSpy.mockRestore();
    });
});
