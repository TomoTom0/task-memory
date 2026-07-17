import { describe, it, expect } from 'vitest';
import {
    isTaskStatus,
    canTransition,
    requiresGate,
    TASK_STATUSES,
    displayId,
} from '../src/utils/statusGuard';

describe('statusGuard', () => {
    describe('TASK_STATUSES', () => {
        it('includes blocked', () => {
            expect(TASK_STATUSES).toContain('blocked');
            expect(TASK_STATUSES).toContain('todo');
            expect(TASK_STATUSES).toContain('closed');
        });
    });

    describe('isTaskStatus', () => {
        it('accepts all declared statuses', () => {
            for (const s of TASK_STATUSES) {
                expect(isTaskStatus(s)).toBe(true);
            }
        });

        it('rejects invalid values', () => {
            expect(isTaskStatus('blocking')).toBe(false);
            expect(isTaskStatus('')).toBe(false);
            expect(isTaskStatus(undefined)).toBe(false);
            expect(isTaskStatus(123)).toBe(false);
            expect(isTaskStatus(null)).toBe(false);
        });
    });

    describe('canTransition', () => {
        it('forbids transitioning out of blocked', () => {
            expect(canTransition('blocked', 'wip')).toBe(false);
            expect(canTransition('blocked', 'todo')).toBe(false);
            expect(canTransition('blocked', 'done')).toBe(false);
            expect(canTransition('blocked', 'pending')).toBe(false);
        });

        it('allows staying blocked', () => {
            expect(canTransition('blocked', 'blocked')).toBe(true);
        });

        it('allows other transitions freely (existing behavior preserved)', () => {
            expect(canTransition('todo', 'wip')).toBe(true);
            expect(canTransition('wip', 'done')).toBe(true);
            expect(canTransition('pending', 'wip')).toBe(true);
            expect(canTransition('long', 'blocked')).toBe(true);
        });
    });

    describe('requiresGate', () => {
        it('requires gate only for blocked', () => {
            expect(requiresGate('blocked')).toBe(true);
            expect(requiresGate('todo')).toBe(false);
            expect(requiresGate('wip')).toBe(false);
            expect(requiresGate('pending')).toBe(false);
            expect(requiresGate('long')).toBe(false);
        });
    });

    describe('displayId', () => {
        it('extracts number from TASK-N', () => {
            expect(displayId('TASK-5')).toBe('5');
            expect(displayId('TASK-12')).toBe('12');
        });

        it('returns id as-is for non TASK-N', () => {
            expect(displayId('abc')).toBe('abc');
        });
    });
});
