import { loadTasks, saveTasks, getTaskById } from '../store';

export function releaseCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm release <id...> --version <v>

Options:
  --version <v>    Set version for task(s)
`);
        return;
    }

    let version: string | null = null;
    const ids: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--version') {
            if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                version = args[++i];
            } else {
                console.error('Error: --version requires a value.');
                return;
            }
        } else if (arg.startsWith('--')) {
            console.warn(`Warning: Unknown option '${arg}'.`);
        } else {
            ids.push(arg);
        }
    }

    if (!version) {
        console.error('Error: --version <v> is required.');
        return;
    }

    if (ids.length === 0) {
        console.error('Error: No task IDs specified.');
        return;
    }

    const tasks = loadTasks();
    let updated = false;

    for (const id of ids) {
        const task = getTaskById(tasks, id);
        if (task) {
            task.version = version;
            task.updated_at = new Date().toISOString();
            updated = true;
            console.log(`Task ${id} version set to ${version}`);
        } else {
            console.error(`Error: Task ${id} not found.`);
        }
    }

    if (updated) {
        saveTasks(tasks);
    }
}
