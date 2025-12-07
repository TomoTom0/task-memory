import { loadTasks, saveTasks, getNextId } from '../store';
import type { Task, TaskStatus } from '../types';

export function newCommand(args: string[]): void {
    const summaryParts: string[] = [];
    let status: TaskStatus = 'todo';
    const bodies: string[] = [];
    const addFiles: string[] = [];
    const readFiles: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            switch (arg) {
                case '--status':
                    const s = args[++i];
                    if (s && ['todo', 'wip', 'done'].includes(s)) {
                        status = s as TaskStatus;
                    } else {
                        console.error(`Error: Invalid status '${s}'. Allowed: todo, wip, done.`);
                        return;
                    }
                    break;
                case '--body':
                    const b = args[++i];
                    if (b) bodies.push(b);
                    else {
                        console.error('Error: --body requires a text argument.');
                        return;
                    }
                    break;
                case '--add-file':
                    const af = args[++i];
                    if (af) addFiles.push(af);
                    else {
                        console.error('Error: --add-file requires a path argument.');
                        return;
                    }
                    break;
                case '--read-file':
                    const rf = args[++i];
                    if (rf) readFiles.push(rf);
                    else {
                        console.error('Error: --read-file requires a path argument.');
                        return;
                    }
                    break;
                default:
                    console.error(`Warning: Unknown option '${arg}'.`);
            }
        } else {
            summaryParts.push(arg);
        }
    }

    const summary = summaryParts.join(' ');
    if (!summary) {
        console.error('Error: Task summary is required. Usage: tm new <summary> [options]');
        return;
    }

    const tasks = loadTasks();
    const id = getNextId(tasks);
    const now = new Date().toISOString();

    const newTask: Task = {
        id,
        status,
        summary,
        bodies: bodies.map(text => ({ text, created_at: now })),
        files: {
            read: readFiles,
            edit: addFiles
        },
        created_at: now,
        updated_at: now
    };

    tasks.push(newTask);
    saveTasks(tasks);

    console.log(`${id} ${summary}`);
}
