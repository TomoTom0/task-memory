import { loadTasks } from '../store';
import { loadReviews } from '../reviewStore';

export function listCommand(args: string[] = []): void {
    const showAll = args.includes('--all') || args.includes('-a');
    const tasks = loadTasks();
    const activeTasks = tasks.filter(t => {
        if (t.status === 'done' || t.status === 'closed') return false;
        if (!showAll && (t.status === 'pending' || t.status === 'long')) return false;
        return true;
    });

    const reviews = loadReviews();
    const checkingReviews = reviews.filter(r => r.status === 'checking');

    if (activeTasks.length === 0 && checkingReviews.length === 0) {
        return;
    }

    activeTasks.forEach(task => {
        // Format: 1: Summary [status] (Priority: P)
        // Extract number from ID for display if possible, else use full ID
        const match = task.id.match(/^TASK-(\d+)$/);
        const displayId = match ? match[1] : task.id;
        const priorityStr = task.priority ? ` (Priority: ${task.priority})` : '';
        console.log(`${displayId}: ${task.summary} [${task.status}]${priorityStr}`);
    });

    checkingReviews.forEach(review => {
        console.log(`${review.id}: ${review.title} [${review.status}]`);
    });
}
