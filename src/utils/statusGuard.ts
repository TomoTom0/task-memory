import type { Task, TaskStatus } from '../types';

/**
 * 全 status のリスト。new/update での検証やドキュメント生成で共有する唯一の真実。
 * これを使うことで `as TaskStatus` / `as any` キャストを不要にする。
 */
export const TASK_STATUSES = [
    'todo',
    'wip',
    'done',
    'pending',
    'long',
    'blocked',
    'closed',
] as const;

/**
 * 文字列が有効な TaskStatus かを判定する型ガード。
 */
export function isTaskStatus(s: unknown): s is TaskStatus {
    return typeof s === 'string'
        && (TASK_STATUSES as readonly string[]).includes(s);
}

/**
 * blocked は「着手禁止の強い保留状態」。
 * blocked -> 他status への通常遷移は禁止（tm unblock または --force 経由のみ許可）。
 * それ以外の遷移は現状通り自由（既存の挙動を変えない）。
 *
 * 将来 status 間の遷移を表駆動で制御したくなった場合、この関数が拡張点になる。
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
    if (from === 'blocked' && to !== 'blocked') return false;
    return true;
}

/**
 * blocked 状態のタスクから他 status への遷移を阻止した場合のエラーメッセージ。
 * LLM に「勝手に再開禁止」を強く伝えるため、開始条件と正規の解除手順を明示する。
 */
export function blockedExitMessage(task: Task): string {
    const id = displayId(task.id);
    const gateText = task.gate ? `"${task.gate}"` : '(not set)';
    return [
        `Error: Task ${id} is blocked and cannot be resumed automatically.`,
        `  Start condition (gate): ${gateText}`,
        `To resume, the gate MUST be satisfied first:`,
        `  - Confirm the start condition is met, then run: tm unblock ${id}`,
        `  - Or force (only with explicit user approval): tm update ${id} --status wip --force`,
        `Do NOT resume a blocked task on your own judgment.`,
    ].join('\n');
}

/**
 * blocked 化にあたり gate（開始条件）が必要か。
 */
export function requiresGate(status: TaskStatus): boolean {
    return status === 'blocked';
}

/**
 * ID（例: TASK-5）を表示用の数値（例: 5）に変換する。
 * TASK-N 形式でなければそのまま返す。
 */
export function displayId(id: string): string {
    const match = id.match(/^TASK-(\d+)$/);
    return match ? match[1]! : id;
}
