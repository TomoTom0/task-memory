import { loadTasks, getTaskById } from '../store';

export function getCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm get <id...> [options]

Options:
  --all, -a, --history     Show full history of bodies
  --last <N>               Show first and last N-1 bodies (total N)
`);
        return;
    }

    const showAllHistory = args.includes('--all') || args.includes('-a') || args.includes('--history');
    let lastN: number | null = null;
    const ids: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg === '--last') {
            const val = args[++i];
            if (val) {
                const n = Number(val);
                if (!Number.isInteger(n) || n < 1) {
                    console.error(`Error: --last requires a positive integer, got '${val}'.`);
                    return;
                }
                lastN = n;
            } else {
                console.error('Error: --last requires a number argument.');
                return;
            }
        } else if (arg.startsWith('-')) {
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
    const result: object[] = [];

    for (const id of ids) {
        const task = getTaskById(tasks, id);
        if (task) {
            const taskOutput: Record<string, unknown> = { ...task };

            if (showAllHistory) {
                // 全件表示
            } else if (lastN !== null) {
                const total = task.bodies.length;
                if (total <= lastN) {
                    // 全件収まるのでそのまま
                } else if (lastN === 1) {
                    const lastBody = task.bodies[total - 1];
                    taskOutput.bodies = lastBody ? [lastBody] : [];
                    const omitted = total - 1;
                    if (omitted > 0) {
                        taskOutput._bodies_note = omitted + (omitted === 1 ? ' more body available' : ' more bodies available') + ' (use --all to show all)';
                    }
                } else {
                    // 最初の1件 + 末尾の(lastN-1)件
                    const head = task.bodies[0];
                    const tail = task.bodies.slice(total - (lastN - 1));
                    taskOutput.bodies = head ? [head, ...tail] : tail;
                    const omitted = total - lastN;
                    if (omitted > 0) {
                        taskOutput._bodies_note = omitted + (omitted === 1 ? ' body omitted' : ' bodies omitted') + ' (use --all to show all)';
                    }
                }
            } else if (task.bodies.length > 0) {
                const lastBody = task.bodies[task.bodies.length - 1];
                if (lastBody) {
                    taskOutput.bodies = [lastBody];
                }
                const omitted = task.bodies.length - 1;
                if (omitted > 0) {
                    taskOutput._bodies_note = omitted + (omitted === 1 ? ' more body available' : ' more bodies available') + ' (use --all to show all, --last N for first and last N-1)';
                }
            }

            result.push(taskOutput);
        } else {
            console.error(`Error: ID '${id}' not found.`);
        }
    }

    console.log(JSON.stringify(result, null, 2));
}
