import type { Task, TaskStatus, TaskBody } from '../types';
import { getCurrentCommit } from '../store';
import { isTaskStatus, requiresGate, TASK_STATUSES } from './statusGuard';

export interface TaskBuildOptions {
    summary?: string;
    status?: TaskStatus;
    priority?: string;
    goal?: string;
    gate?: string;
    order?: string | null;
    bodies?: string[];
    addFiles?: string[];
    readFiles?: string[];
    version?: string;
}

/**
 * 引数配列からタスク作成オプションをパースする
 * newCommandとreview acceptで共通利用
 * @throws Error 無効なオプションが見つかった場合
 */
export function parseTaskArgs(args: string[]): TaskBuildOptions {
    const summaryParts: string[] = [];
    let status: TaskStatus = 'todo';
    let gate: string | undefined;
    let priority: string | undefined;
    let goal: string | undefined;
    let order: string | null | undefined;
    const bodies: string[] = [];
    const addFiles: string[] = [];
    const readFiles: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg.startsWith('-')) {
            switch (arg) {
                case '--status':
                case '-s':
                    const s = args[i + 1];
                    if (s && !s.startsWith('-')) {
                        if (isTaskStatus(s)) {
                            status = s;
                            i++;
                        } else {
                            throw new Error(`Invalid status '${s}'. Allowed: ${TASK_STATUSES.join(', ')}.`);
                        }
                    } else {
                        throw new Error('--status requires a value.');
                    }
                    break;
                case '--goal':
                case '-g':
                    const g = args[i + 1];
                    if (g && !g.startsWith('-')) {
                        goal = g;
                        i++;
                    } else {
                        throw new Error('--goal requires a value.');
                    }
                    break;
                case '--gate':
                    const gateVal = args[i + 1];
                    if (gateVal && !gateVal.startsWith('-')) {
                        gate = gateVal;
                        i++;
                    } else {
                        throw new Error('--gate requires a value.');
                    }
                    break;
                case '--priority':
                case '-p':
                    const p = args[i + 1];
                    if (p && !p.startsWith('-')) {
                        priority = p;
                        i++;
                    } else {
                        throw new Error('--priority requires a value.');
                    }
                    break;
                case '--order':
                case '-o':
                    const o = args[i + 1];
                    if (o && !o.startsWith('-')) {
                        order = o === 'null' ? null : o;
                        i++;
                    } else {
                        throw new Error('--order requires a value.');
                    }
                    break;
                case '--body':
                case '-b':
                    const b = args[i + 1];
                    if (b && !b.startsWith('-')) {
                        bodies.push(b);
                        i++;
                    } else {
                        throw new Error('--body requires a value.');
                    }
                    break;
                case '--add-file':
                case '-a':
                    const af = args[i + 1];
                    if (af && !af.startsWith('-')) {
                        addFiles.push(af);
                        i++;
                    } else {
                        throw new Error('--add-file requires a path.');
                    }
                    break;
                case '--read-file':
                case '-r':
                    const rf = args[i + 1];
                    if (rf && !rf.startsWith('-')) {
                        readFiles.push(rf);
                        i++;
                    } else {
                        throw new Error('--read-file requires a path.');
                    }
                    break;
                default:
                    throw new Error(`Unknown option '${arg}'.`);
            }
        } else {
            summaryParts.push(arg);
        }
    }

    if (requiresGate(status) && !gate) {
        throw new Error('Status "blocked" requires --gate "..." (the start condition that must be met before resuming).');
    }

    return {
        summary: summaryParts.join(' ') || undefined,
        status,
        priority,
        goal,
        gate,
        order,
        bodies,
        addFiles,
        readFiles,
    };
}

/**
 * TaskBuildOptionsからTaskオブジェクトを構築する
 */
export function buildTask(id: string, options: TaskBuildOptions): Task {
    const now = new Date().toISOString();
    const status = options.status || 'todo';

    // todo, wip 以外は order を null にする
    const order = (status === 'todo' || status === 'wip')
        ? (options.order ?? null)
        : null;

    const created_commit = getCurrentCommit();

    return {
        id,
        status,
        priority: options.priority,
        version: options.version || 'tbd',
        goal: options.goal,
        gate: options.gate,
        order,
        summary: options.summary || '',
        bodies: (options.bodies || []).map(text => ({ text, created_at: now })),
        files: {
            read: options.readFiles || [],
            edit: options.addFiles || []
        },
        created_at: now,
        updated_at: now,
        ...(created_commit ? { created_commit, updated_commit: created_commit } : {}),
    };
}
