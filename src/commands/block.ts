import { loadTasks, saveTasks, getTaskById, getCurrentCommit } from '../store';
import { displayId } from '../utils/statusGuard';

export function blockCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm block <id...> --gate "..." [options]

Mark task(s) as blocked. A blocked task cannot be resumed until its gate
(start condition) is satisfied, and any attempt to move it out of blocked
(e.g. tm update --status wip, tm finish) is rejected unless forced.

Options:
  --gate <text>    Required. The start condition that must be met before resuming.
`);
        return;
    }

    const ids: string[] = [];
    let gate: string | null = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;
        if (arg === '--gate') {
            const v = args[++i];
            if (v && !v.startsWith('-')) {
                gate = v;
            } else {
                console.error('Error: --gate requires a value.');
                return;
            }
        } else if (arg.startsWith('-')) {
            console.error(`Error: Unknown option '${arg}'.`);
            return;
        } else {
            ids.push(arg);
        }
    }

    if (ids.length === 0) {
        console.error('Error: Task ID is required. Usage: tm block <id...> --gate "..."');
        return;
    }

    if (!gate) {
        console.error('Error: --gate is required. Specify the start condition that must be met before resuming.');
        console.error('Usage: tm block <id...> --gate "..."');
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
        if (task.status === 'done' || task.status === 'closed') {
            console.error(`Error: Task ${displayId(task.id)} is '${task.status}' and cannot be blocked.`);
            continue;
        }
        const alreadyBlocked = task.status === 'blocked';
        task.status = 'blocked';
        task.gate = gate;
        // order は todo/wip 以外なので saveTasks の正規化で null になる
        task.updated_at = new Date().toISOString();
        task.updated_commit = commit;
        updatedCount++;
        if (alreadyBlocked) {
            console.log(`Task ${displayId(task.id)} gate updated (was already blocked): "${gate}".`);
        } else {
            console.log(`Task ${displayId(task.id)} blocked. Start condition (gate): "${gate}".`);
        }
    }

    if (updatedCount > 0) {
        saveTasks(tasks);
    }
}
