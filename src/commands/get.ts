import { loadTasks, getTaskById } from '../store';

export function getCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm get <id...> [options]

Options:
  --all, -a, --history     Show full history of bodies
`);
        return;
    }

    // Parse options
    const showAllHistory = args.includes('--all') || args.includes('-a') || args.includes('--history');
    const ids: string[] = [];

    for (const arg of args) {
        if (arg.startsWith('-')) {
            if (arg !== '--all' && arg !== '-a' && arg !== '--history') {
                console.error(`Error: Unknown option '${arg}'.`);
                return;
            }
        } else {
            ids.push(arg);
        }
    }

    if (ids.length === 0) {
        console.error('Error: Task ID is required. Usage: tm get <id...> [options]');
        return;
    }

    const tasks = loadTasks();
    const result = [];

    for (const id of ids) {
        const task = getTaskById(tasks, id);
        if (task) {
            // Clone task to avoid mutating store data if we were to modify it (though we just read here)
            // We need to filter bodies if not showAllHistory
            const taskOutput = { ...task };
            if (!showAllHistory && task.bodies.length > 0) {
                const lastBody = task.bodies[task.bodies.length - 1];
                if (lastBody) {
                    taskOutput.bodies = [lastBody];
                }
            }
            result.push(taskOutput);
        } else {
            console.error(`Error: ID '${id}' not found.`);
        }
    }

    console.log(JSON.stringify(result, null, 2));
}
