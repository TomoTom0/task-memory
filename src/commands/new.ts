import { loadTasks, saveTasks, getNextId } from '../store';
import type { Task, TaskStatus } from '../types';

export function newCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm new <summary> [options]

Options:
  --status, -s <status>    Set initial status (todo, wip, done, pending, long, closed)
  --priority, -p <value>   Set priority
  --goal, -g <text>        Set completion goal
  --body, -b <text>        Add initial body text
  --add-file, -a <path>    Add editable file
  --read-file, -r <path>   Add read-only file
`);
        return;
    }

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
                    } else {
                        console.error(`Error: Invalid status '${s}'. Allowed: todo, wip, done, pending, long, closed.`);
                        return;
                    }
                    break;
                case '--goal':
                case '-g':
                    const g = args[++i];
                    if (g) goal = g;
                    else {
                        console.error('Error: --goal requires a value.');
                        return;
                    }
                    break;
                case '--priority':
                case '-p':
                    const p = args[++i];
                    if (p) priority = p;
                    else {
                        console.error('Error: --priority requires a value.');
                        return;
                    }
                    break;
                case '--body':
                case '-b':
                    const b = args[++i];
                    if (b) bodies.push(b);
                    else {
                        console.error('Error: --body requires a text argument.');
                        return;
                    }
                    break;
                case '--add-file':
                case '-a':
                    const af = args[++i];
                    if (af) addFiles.push(af);
                    else {
                        console.error('Error: --add-file requires a path argument.');
                        return;
                    }
                    break;
                case '--read-file':
                case '-r':
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
        priority,
        version: 'tbd',
        goal,
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
