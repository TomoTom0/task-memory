import { loadTasks } from '../store';

export function listCommand(): void {
    const tasks = loadTasks();
    const activeTasks = tasks.filter(t => t.status !== 'done');

    if (activeTasks.length === 0) {
        return;
    }

    activeTasks.forEach(task => {
        // Format: 1: Summary [status]
        // Extract number from ID for display if possible, else use full ID
        const match = task.id.match(/^TASK-(\d+)$/);
        const displayId = match ? match[1] : task.id;
        console.log(`${displayId}: ${task.summary} [${task.status}]`);
    });
}
