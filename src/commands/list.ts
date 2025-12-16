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
  --status, -s <s> Filter by status
  --version <v>    Filter by version
  --tbd            Filter by version 'tbd' (includes closed/done)
  --released       Filter by released tasks (non-tbd version, includes closed/done)
  --head [N]       Show first N tasks (default: 10)
  --tail [N]       Show last N tasks (default: 10)
`);
        return;
    }

    function parseNumericOption(optionName: string, defaultValue: number): number | null {
        const index = args.indexOf(optionName);
        if (index === -1) return null;

        const nextArg = args[index + 1];
        if (nextArg && !nextArg.startsWith('-')) {
            const parsed = parseInt(nextArg, 10);
            return isNaN(parsed) ? defaultValue : parsed;
        }
        return defaultValue;
    }

    let showAll = false;
    let showOpen = false;
    let filterPriority: string | null = null;
    let filterStatus: string | null = null;
    let filterVersion: string | null = null;
    let released = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--status-all':
            case '-a':
                showAll = true;
                break;
            case '--open':
                showOpen = true;
                break;
            case '--priority':
                if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                    filterPriority = args[++i];
                } else {
                    console.error("Error: --priority requires a value.");
                    return;
                }
                break;
            case '--status':
            case '-s':
                if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                    filterStatus = args[++i];
                } else {
                    console.error("Error: --status requires a value.");
                    return;
                }
                break;
            case '--version':
                if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
                    filterVersion = args[++i];
                } else {
                    console.error("Error: --version requires a value.");
                    return;
                }
                break;
            case '--tbd':
                filterVersion = 'tbd';
                showAll = true;
                break;
            case '--released':
                released = true;
                showAll = true;
                break;
            case '--head':
            case '--tail':
                // Skip numeric option handling here, will be parsed separately
                const nextArg = args[i + 1];
                if (nextArg && !nextArg.startsWith('-')) {
                    i++; // Skip the value
                }
                break;
            default:
                if (arg.startsWith('--')) {
                    console.error(`Error: Unknown option '${arg}'.`);
                    return;
                } else if (!arg.match(/^\d+$/)) {
                    // list command does not take positional arguments (except numeric ones for head/tail)
                    console.error(`Error: Unknown argument '${arg}'.`);
                    return;
                }
                break;
        }
    }

    // Head and tail options
    const headCount = parseNumericOption('--head', 10);
    const tailCount = parseNumericOption('--tail', 10);

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
        // If status is explicitly filtered, show those tasks regardless of other visibility rules
        if (filterStatus) return true;

        if (showAll) return true;

        if (t.status === 'done' || t.status === 'closed') return false;

        if (!showOpen && (t.status === 'pending' || t.status === 'long')) return false;

        return true;
    });

    const reviews = loadReviews();
    const checkingReviews = reviews.filter(r => r.status === 'checking');

    // Apply head/tail to tasks and reviews
    let displayTasks = activeTasks;
    let displayReviews = checkingReviews;

    if (headCount !== null) {
        displayTasks = activeTasks.slice(0, headCount);
        const remaining = headCount - displayTasks.length;
        displayReviews = remaining > 0 ? checkingReviews.slice(0, remaining) : [];
    } else if (tailCount !== null) {
        const totalLength = activeTasks.length + checkingReviews.length;
        const startIndex = Math.max(0, totalLength - tailCount);

        const tasksToSkip = Math.min(startIndex, activeTasks.length);
        displayTasks = activeTasks.slice(tasksToSkip);

        const reviewsToSkip = Math.max(0, startIndex - activeTasks.length);
        displayReviews = checkingReviews.slice(reviewsToSkip);
    }

    if (displayTasks.length === 0 && displayReviews.length === 0) {
        return;
    }

    displayTasks.forEach(task => {
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

    displayReviews.forEach(review => {
        console.log(`${review.id}: ${review.title} [${review.status}]`);
    });
}
