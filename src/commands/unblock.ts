import { loadTasks, saveTasks, getTaskById, getCurrentCommit } from '../store';
import { displayId } from '../utils/statusGuard';
import type { TaskStatus } from '../types';

export function unblockCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm unblock <id...> [--status todo|wip]

Clear the gate and move a blocked task back to an actionable status.
Default target status is "todo"; use --status wip to resume immediately.
Resuming a blocked task should only happen once its gate is satisfied.

Options:
  --status, -s <status>   Target status after unblock (todo or wip). Default: todo.
`);
        return;
    }

    const ids: string[] = [];
    let newStatus: TaskStatus = 'todo';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === '--status' || arg === '-s') {
            const v = args[++i];
            if (v === 'todo' || v === 'wip') {
                newStatus = v;
            } else {
                console.error(`Error: --status for unblock must be 'todo' or 'wip' (got '${v}').`);
                return;
            }
        } else if (arg.startsWith('--')) {
            console.error(`Error: Unknown option '${arg}'.`);
            return;
        } else {
            ids.push(arg);
        }
    }

    if (ids.length === 0) {
        console.error('Error: Task ID is required. Usage: tm unblock <id...> [--status wip]');
        return;
    }

    const tasks = loadTasks();
    const commit = getCurrentCommit();
    let updatedCount = 0;

    for (const id of ids) {
        const task = getTaskById(tasks, id);
        if (!task) {
            console.error(`Error: ID '${id}' not found.`);
            continue;
        }
        if (task.status !== 'blocked') {
            console.warn(`Task ${displayId(task.id)} is not blocked (status: ${task.status}). Skipped.`);
            continue;
        }
        task.status = newStatus;
        task.gate = undefined;
        task.updated_at = new Date().toISOString();
        task.updated_commit = commit;
        updatedCount++;
        console.log(`Task ${displayId(task.id)} unblocked -> ${newStatus}.`);
    }

    if (updatedCount > 0) {
        saveTasks(tasks);
    }
}
