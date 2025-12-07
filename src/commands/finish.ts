import { loadTasks, saveTasks, getTaskById } from '../store';

export function finishCommand(args: string[]): void {
    if (args.length === 0) {
        console.error('Error: Task ID is required. Usage: tm finish <id...>');
        return;
    }

    const tasks = loadTasks();
    let updated = false;

    for (const id of args) {
        const task = getTaskById(tasks, id);
        if (task) {
            task.status = 'done';
            task.updated_at = new Date().toISOString();
            updated = true;
            console.log(`Task ${task.id} marked as done.`);
        } else {
            console.error(`Error: ID '${id}' not found.`);
        }
    }

    if (updated) {
        saveTasks(tasks);
    }
}
