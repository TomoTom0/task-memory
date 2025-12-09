import { loadTasks } from '../store';
import { loadReviews } from '../reviewStore';

export function listCommand(args: string[] = []): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm list [options]

Options:
  --status-all, -a Show all tasks (including done/closed)
  --open           Show all open tasks (todo, wip, pending, long)
  --priority <p>   Filter by priority
  --status <s>     Filter by status
  --version <v>    Filter by version
  --tbd            Filter by version 'tbd' (includes closed/done)
  --released       Filter by released tasks (non-tbd version, includes closed/done)
`);
        return;
    }

    let showAll = args.includes('--status-all') || args.includes('-a');
    const showOpen = args.includes('--open');

    // Filter by priority
    const priorityIndex = args.indexOf('--priority');
    const filterPriority = priorityIndex !== -1 ? args[priorityIndex + 1] : null;

    // Filter by status
    const statusIndex = args.indexOf('--status');
    const filterStatus = statusIndex !== -1 ? args[statusIndex + 1] : null;

    // Filter by version
    let versionIndex = args.indexOf('--version');
    let filterVersion = versionIndex !== -1 ? args[versionIndex + 1] : null;

    // --tbd alias: equivalent to --version tbd -a
    if (args.includes('--tbd')) {
        filterVersion = 'tbd';
        showAll = true;
    }

    const released = args.includes('--released');
    if (released) {
        showAll = true;
    }

    const tasks = loadTasks();
    const activeTasks = tasks.filter(t => {
        // Apply filters first
        if (filterPriority && t.priority !== filterPriority) return false;
        if (filterStatus && t.status !== filterStatus) return false;
        if (filterVersion && t.version !== filterVersion) return false;

        if (released) {
            if (!t.version || t.version === 'tbd' || t.version === '') return false;
        }

        // Visibility logic
        if (showAll) return true;

        if (t.status === 'done' || t.status === 'closed') return false;

        if (!showOpen && (t.status === 'pending' || t.status === 'long')) return false;

        return true;
    });

    const reviews = loadReviews();
    const checkingReviews = reviews.filter(r => r.status === 'checking');

    if (activeTasks.length === 0 && checkingReviews.length === 0) {
        return;
    }

    activeTasks.forEach(task => {
        // Format: 1: Summary [status] (Priority: P) [v: 1.0]
        // Extract number from ID for display if possible, else use full ID
        const match = task.id.match(/^TASK-(\d+)$/);
        const displayId = match ? match[1] : task.id;
        const priorityStr = task.priority ? ` (Priority: ${task.priority})` : '';

        // Display version if set and not tbd (unless filtering by version, then maybe we assume they know?)
        // Requirement: "listでは未設定の項目は表示しなくていい" -> "Items not set in list do not need to be displayed"
        // "newで作成した時点でtbdが設定される" -> "tbd is set when created with new"
        // So if version is 'tbd' or undefined/empty, don't show it.
        let versionStr = '';
        if (task.version && task.version !== 'tbd') {
            versionStr = ` [v:${task.version}]`;
        }

        console.log(`${displayId}: ${task.summary} [${task.status}]${priorityStr}${versionStr}`);
    });

    checkingReviews.forEach(review => {
        console.log(`${review.id}: ${review.title} [${review.status}]`);
    });
}
