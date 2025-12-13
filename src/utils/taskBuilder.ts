import type { Task, TaskStatus, TaskBody } from '../types';

export interface TaskBuildOptions {
    summary?: string;
    status?: TaskStatus;
    priority?: string;
    goal?: string;
    bodies?: string[];
    addFiles?: string[];
    readFiles?: string[];
    version?: string;
}

/**
 * 引数配列からタスク作成オプションをパースする
 * newCommandとreview acceptで共通利用
 */
export function parseTaskArgs(args: string[]): TaskBuildOptions {
    const summaryParts: string[] = [];
    let status: TaskStatus = 'todo';
    let priority: string | undefined;
    let goal: string | undefined;
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
                    const s = args[++i];
                    if (s && ['todo', 'wip', 'done', 'pending', 'long', 'closed'].includes(s)) {
                        status = s as TaskStatus;
                    }
                    break;
                case '--goal':
                case '-g':
                    const g = args[++i];
                    if (g) goal = g;
                    break;
                case '--priority':
                case '-p':
                    const p = args[++i];
                    if (p) priority = p;
                    break;
                case '--body':
                case '-b':
                    const b = args[++i];
                    if (b) bodies.push(b);
                    break;
                case '--add-file':
                case '-a':
                    const af = args[++i];
                    if (af) addFiles.push(af);
                    break;
                case '--read-file':
                case '-r':
                    const rf = args[++i];
                    if (rf) readFiles.push(rf);
                    break;
            }
        } else {
            summaryParts.push(arg);
        }
    }

    return {
        summary: summaryParts.join(' ') || undefined,
        status,
        priority,
        goal,
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

    return {
        id,
        status: options.status || 'todo',
        priority: options.priority,
        version: options.version || 'tbd',
        goal: options.goal,
        summary: options.summary || '',
        bodies: (options.bodies || []).map(text => ({ text, created_at: now })),
        files: {
            read: options.readFiles || [],
            edit: options.addFiles || []
        },
        created_at: now,
        updated_at: now
    };
}
