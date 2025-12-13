import { loadTasks, saveTasks, getTaskById } from '../store';
import type { Task } from '../types';

export function finishCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm finish <id...> [options]

Options:
  --body <body>    Add a closing comment
`);
        return;
    }

    // If no args provided
    if (args.length === 0) {
        console.error('Error: Task ID is required. Usage: tm finish <id...> [--body <body>]');
        return;
    }

    const tasks = loadTasks();
    let currentTargetIds: string[] = [];
    let updated = false;
    let lastActionWasOption = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('--')) {
            lastActionWasOption = true;
            if (arg === '--body') {
                const bodyText = args[++i];
                if (bodyText) {
                    const now = new Date().toISOString();
                    // Apply to all current targets
                    for (const id of currentTargetIds) {
                        const task = getTaskById(tasks, id);
                        if (task) {
                            task.bodies.push({ text: bodyText, created_at: now });
                            task.updated_at = now; // Update timestamp again
                        }
                    }
                } else {
                    console.error('Error: --body requires a text argument.');
                }
            } else {
                console.error(`Warning: Unknown option '${arg}'.`);
            }
        } else {
            // It's an ID
            if (lastActionWasOption) {
                // New batch starting
                currentTargetIds = [];
                lastActionWasOption = false;
            }

            const id = arg;
            const task = getTaskById(tasks, id);
            if (task) {
                // Mark as done immediately
                if (task.status !== 'done') {
                    task.status = 'done';
                    task.updated_at = new Date().toISOString();
                    console.log(`Task ${task.id} marked as done.`);
                    updated = true;
                } else {
                    console.log(`Task ${task.id} is already done.`);
                }
                currentTargetIds.push(id);
            } else {
                console.error(`Error: ID '${id}' not found.`);
            }
        }
    }

    if (updated) {
        saveTasks(tasks);
    }
}
