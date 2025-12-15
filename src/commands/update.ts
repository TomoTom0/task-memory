import { loadTasks, saveTasks, getTaskById } from '../store';
import type { Task } from '../types';

export function updateCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm update <id...> [options]

Options:
  --status, -s <status>    Update status (todo, wip, done, pending, long, closed)
  --priority, -p <value>   Update priority
  --version, -v <value>    Update version
  --goal, -g <text>        Update completion goal
  --body, -b <text>        Append body text
  --add-file, -a <path>    Add editable file
  --rm-file, -d <path>     Remove editable file
  --read-file, -r <path>   Add read-only file
`);
        return;
    }

    const tasks = loadTasks();
    let currentTargetIds: string[] = [];
    let updated = false;
    let lastActionWasOption = false;

    // Helper to apply updates to current targets
    const applyUpdate = (action: (task: Task) => void) => {
        if (currentTargetIds.length === 0) {
            console.error('Error: No task ID specified for update. Usage: tm update <id> [options] ...');
            return;
        }
        for (const id of currentTargetIds) {
            const task = getTaskById(tasks, id);
            if (task) {
                action(task);
                task.updated_at = new Date().toISOString();
                updated = true;
            } else {
                console.error(`Error: ID '${id}' not found.`);
            }
        }
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('-')) {
            // Option handling
            lastActionWasOption = true;
            switch (arg) {
                case '--status':
                case '-s':
                    const status = args[++i];
                    if (status && ['todo', 'wip', 'done', 'pending', 'long', 'closed'].includes(status)) {
                        applyUpdate(t => t.status = status as any);
                    } else {
                        console.error(`Error: Invalid status '${status}'. Allowed: todo, wip, done, pending, long, closed.`);
                    }
                    break;
                case '--priority':
                case '-p':
                    const priority = args[++i];
                    if (priority) {
                        applyUpdate(t => t.priority = priority);
                    } else {
                        console.error('Error: --priority requires a value.');
                    }
                    break;
                case '--version':
                case '-v':
                    const version = args[++i];
                    if (version) {
                        applyUpdate(t => t.version = version);
                    } else {
                        console.error('Error: --version requires a value.');
                    }
                    break;
                case '--goal':
                case '-g':
                    const goal = args[++i];
                    if (goal) {
                        applyUpdate(t => t.goal = goal);
                    } else {
                        console.error('Error: --goal requires a value.');
                    }
                    break;
                case '--body':
                case '-b':
                    const bodyText = args[++i];
                    if (bodyText) {
                        applyUpdate(t => t.bodies.push({
                            text: bodyText,
                            created_at: new Date().toISOString()
                        }));
                    } else {
                        console.error('Error: --body requires a text argument.');
                    }
                    break;
                case '--add-file':
                case '-a':
                    const addPath = args[++i];
                    if (addPath) {
                        applyUpdate(t => {
                            if (!t.files.edit.includes(addPath)) {
                                t.files.edit.push(addPath);
                            }
                        });
                    } else {
                        console.error('Error: --add-file requires a path argument.');
                    }
                    break;
                case '--rm-file':
                case '-d':
                    const rmPath = args[++i];
                    if (rmPath) {
                        applyUpdate(t => {
                            t.files.edit = t.files.edit.filter(p => p !== rmPath);
                        });
                    } else {
                        console.error('Error: --rm-file requires a path argument.');
                    }
                    break;
                case '--read-file':
                case '-r':
                    const readPath = args[++i];
                    if (readPath) {
                        applyUpdate(t => {
                            if (!t.files.read.includes(readPath)) {
                                t.files.read.push(readPath);
                            }
                        });
                    } else {
                        console.error('Error: --read-file requires a path argument.');
                    }
                    break;
                default:
                    console.error(`Error: Unknown option '${arg}'.`);
                    return;
            }
        } else {
            // ID handling
            if (lastActionWasOption) {
                currentTargetIds = [];
                lastActionWasOption = false;
            }
            // Assume anything not starting with -- is an ID (or invalid garbage, but we treat as ID for lookup)
            // The spec says "ID (numeric or TASK-n)". 
            // We can be loose and try to use it as ID.
            currentTargetIds.push(arg);
        }
    }

    if (updated) {
        saveTasks(tasks);
        console.log('Tasks updated.');
    }
}
