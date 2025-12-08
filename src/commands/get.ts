import { loadTasks, getTaskById } from '../store';

export function getCommand(args: string[]): void {
    // Parse options
    const showAllHistory = args.includes('--all') || args.includes('-a') || args.includes('--history') || args.includes('-h');
    const ids = args.filter(arg => !arg.startsWith('-'));

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
