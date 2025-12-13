import { loadReviews, saveReviews, getNextReviewId, getReviewById } from '../reviewStore';
import { loadTasks, saveTasks, getTaskById, getNextId } from '../store';
import { parseTaskArgs, buildTask } from '../utils/taskBuilder';
import type { Review, ReviewStatus, Task } from '../types';

export function reviewCommand(args: string[]) {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm review <command> [args]

Commands:
  new <title> --body <body>
  list
  get <id> [--history]
  update <id> [--status <status> --body <body>]
  return <id> [--status <status> --body <body>]
  accept <id> [--new <summary>...]
  reject <id>
`);
        return;
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    switch (subcommand) {
        case 'new':
            handleNew(subArgs);
            break;
        case 'list':
            handleList();
            break;
        case 'get':
            handleGet(subArgs);
            break;
        case 'update':
            handleUpdate(subArgs);
            break;
        case 'return':
            handleReturn(subArgs);
            break;
        case 'accept':
            handleAccept(subArgs);
            break;
        case 'reject':
            handleReject(subArgs);
            break;
        default:
            console.error(`Unknown review subcommand: ${subcommand}`);
            console.log(`
Usage: tm review <command> [args]

Commands:
  new <title> --body <body>
  list
  get <id> [--history]
  update <id> [--status <status> --body <body>]
  return <id> [--status <status> --body <body>]
  accept <id> [--new <summary>...]
  reject <id>
`);
            process.exit(1);
    }
}

function handleNew(args: string[]) {
    let title = '';
    let body = '';

    // Parse args
    // tm review new <title> --body <body>
    // title might be multiple words if quoted or just first arg if not? 
    // Let's assume title is the first non-flag argument(s) until a flag is hit.

    const titleParts = [];
    let i = 0;
    while (i < args.length) {
        if (args[i].startsWith('--')) break;
        titleParts.push(args[i]);
        i++;
    }
    title = titleParts.join(' ');

    while (i < args.length) {
        if (args[i] === '--body') {
            body = args[i + 1] || '';
            i += 2;
        } else {
            i++;
        }
    }

    if (!title) {
        console.error('Error: Title is required');
        process.exit(1);
    }

    const reviews = loadReviews();
    const newId = getNextReviewId(reviews);
    const now = new Date().toISOString();

    const newReview: Review = {
        id: newId,
        title,
        body,
        bodies: [{ text: body, created_at: now }],
        status: 'todo',
        created_at: now,
        updated_at: now,
    };

    reviews.push(newReview);
    saveReviews(reviews);
    console.log(`Created review ${newId}`);
}

function handleList() {
    const reviews = loadReviews();
    const activeReviews = reviews.filter(r => r.status !== 'closed' && r.status !== 'done');

    if (activeReviews.length === 0) {
        console.log('No active reviews.');
        return;
    }

    console.log('ID\tStatus\tTitle');
    console.log('--\t------\t-----');
    activeReviews.forEach(r => {
        console.log(`${r.id}\t${r.status}\t${r.title}`);
    });
}

function handleGet(args: string[]) {
    const id = args[0];
    const showHistory = args.includes('--history') || args.includes('--all');

    if (!id) {
        console.error('Error: Review ID is required');
        process.exit(1);
    }

    const reviews = loadReviews();
    const review = getReviewById(reviews, id);

    if (!review) {
        console.error(`Error: Review ${id} not found`);
        process.exit(1);
    }

    if (showHistory) {
        console.log(JSON.stringify(review, null, 2));
        return;
    }

    console.log(`Review: ${review.title}`);
    console.log(`ID: ${review.id}`);
    console.log(`Status: ${review.status}`);
    console.log('---');
    console.log('Description:');
    // The first body is the description
    const description = review.bodies[0]?.text || review.body;
    console.log(description);

    // Subsequent bodies are answers/updates
    if (review.bodies.length > 1) {
        console.log('\nAnswers:');
        review.bodies.slice(1).forEach((b, i) => {
            console.log(`\n[${i + 1}] ${b.created_at}`);
            console.log(b.text);
        });
    }

    console.log(`
To reply to this review, run:
tm review return ${id} --body "Your reply here"`);
}

function handleUpdate(args: string[]) {
    const id = args[0];
    if (!id || id.startsWith('--')) {
        console.error('Error: Review ID is required');
        process.exit(1);
    }

    const reviews = loadReviews();
    const review = getReviewById(reviews, id);

    if (!review) {
        console.error(`Error: Review ${id} not found`);
        process.exit(1);
    }

    let status: ReviewStatus | undefined;
    let body: string | undefined;

    let i = 1;
    while (i < args.length) {
        if (args[i] === '--status') {
            const newStatus = args[i + 1];
            const validStatuses: ReviewStatus[] = ['todo', 'wip', 'checking', 'closed', 'done', 'pending'];
            if (!validStatuses.includes(newStatus as ReviewStatus)) {
                console.error(`Error: Invalid status '${newStatus}'. Valid statuses are: ${validStatuses.join(', ')}`);
                process.exit(1);
            }
            status = newStatus as ReviewStatus;
            i += 2;
        } else if (args[i] === '--body') {
            body = args[i + 1];
            i += 2;
        } else {
            i++;
        }
    }

    const now = new Date().toISOString();
    let updated = false;

    if (status) {
        review.status = status;
        updated = true;
    }

    if (body) {
        review.body = body;
        review.bodies.push({ text: body, created_at: now });
        updated = true;
    }

    if (updated) {
        review.updated_at = now;
        saveReviews(reviews);
        console.log(`Updated review ${review.id}`);
    } else {
        console.log('No changes made.');
    }
}

function handleReturn(args: string[]) {
    // Design says: tm review return <review_id> [--status <status> --body <body>]
    // If status is not provided, default to 'checking'
    if (!args.includes('--status')) {
        args.push('--status', 'checking');
    }
    handleUpdate(args);
}

function handleAccept(args: string[]) {
    const id = args[0];
    if (!id || id.startsWith('--')) {
        console.error('Error: Review ID is required');
        process.exit(1);
    }

    const reviews = loadReviews();
    const review = getReviewById(reviews, id);

    if (!review) {
        console.error(`Error: Review ${id} not found`);
        process.exit(1);
    }

    // Parse --new args to create tasks
    // tm review accept <review_id> [--new {tm new args} --new {tm new args}]
    // This parsing is tricky because --new takes arbitrary args.
    // Let's look for --new flags.

    const newTasksArgs: string[][] = [];
    let currentNewArgs: string[] = [];
    let collectingNew = false;

    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--new') {
            if (collectingNew && currentNewArgs.length > 0) {
                newTasksArgs.push([...currentNewArgs]);
            }
            currentNewArgs = [];
            collectingNew = true;
        } else if (collectingNew) {
            // Check if it's another flag that stops --new? 
            // The design says [--add <existing_task_id>] as well.
            if (args[i] === '--add') {
                if (collectingNew && currentNewArgs.length > 0) {
                    newTasksArgs.push([...currentNewArgs]);
                }
                collectingNew = false;
                // Handle --add logic later if needed, but for now let's focus on --new
            } else {
                currentNewArgs.push(args[i]);
            }
        }
    }
    if (collectingNew && currentNewArgs.length > 0) {
        newTasksArgs.push([...currentNewArgs]);
    }

    // Create tasks
    const tasks = loadTasks();
    const createdTaskIds: string[] = [];
    const now = new Date().toISOString();

    for (const taskArgs of newTasksArgs) {
        // We need to parse taskArgs similar to newCommand.
        const options = parseTaskArgs(taskArgs);

        if (options.summary) {
            const newTaskId = getNextId(tasks);
            const newTask = buildTask(newTaskId, options);
            tasks.push(newTask);
            createdTaskIds.push(newTaskId);
            console.log(`Created task ${newTaskId} from review`);
        }
    }

    if (createdTaskIds.length > 0) {
        saveTasks(tasks);
        review.related_task_ids = [...(review.related_task_ids || []), ...createdTaskIds];
    }

    review.status = 'done';
    review.updated_at = now;
    saveReviews(reviews);
    console.log(`Review ${id} accepted and marked as done.`);
}

function handleReject(args: string[]) {
    const id = args[0];
    if (!id) {
        console.error('Error: Review ID is required');
        process.exit(1);
    }

    const reviews = loadReviews();
    const review = getReviewById(reviews, id);

    if (!review) {
        console.error(`Error: Review ${id} not found`);
        process.exit(1);
    }

    review.status = 'closed';
    review.updated_at = new Date().toISOString();
    saveReviews(reviews);
    console.log(`Review ${id} rejected and marked as closed.`);
}
