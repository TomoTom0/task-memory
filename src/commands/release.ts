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

    const versionIndex = args.indexOf('--version');
    if (versionIndex === -1 || !args[versionIndex + 1]) {
        console.error('Error: --version <v> is required.');
        return;
    }
    const version = args[versionIndex + 1];

    // Filter out the --version flag and its value to get IDs
    const ids = args.filter((arg, index) => {
        return index !== versionIndex && index !== versionIndex + 1;
    });

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
