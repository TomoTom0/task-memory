import { loadTasks, saveTasks, getNextId } from '../store';
import { parseTaskArgs, buildTask } from '../utils/taskBuilder';

export function newCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm new <summary> [options]

Options:
  --status, -s <status>    Set initial status (todo, wip, done, pending, long, closed)
  --priority, -p <value>   Set priority
  --goal, -g <text>        Set completion goal
  --body, -b <text>        Add initial body text
  --add-file, -a <path>    Add editable file
  --read-file, -r <path>   Add read-only file
`);
        return;
    }

    let options;
    try {
        options = parseTaskArgs(args);
    } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }

    if (!options.summary) {
        console.error('Error: Task summary is required. Usage: tm new <summary> [options]');
        return;
    }

    const tasks = loadTasks();
    const id = getNextId(tasks);
    const newTask = buildTask(id, options);

    tasks.push(newTask);
    saveTasks(tasks);

    console.log(`${id} ${options.summary}`);
}
