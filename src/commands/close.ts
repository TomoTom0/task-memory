import { loadTasks, saveTasks, getTaskById } from '../store';
import type { TaskBody } from '../types';

export function closeCommand(args: string[]): void {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: tm close <id...> [options]

Options:
  --body <body>    Add a closing comment
`);
    return;
  }

  const ids: string[] = [];
  let bodyText: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--body') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        bodyText = args[++i];
      } else {
        console.error('Error: --body requires a text argument.');
        return;
      }
    } else if (arg.startsWith('--')) {
      console.error(`Error: Unknown option '${arg}'.`);
      return;
    } else {
      ids.push(arg);
    }
  }

  if (ids.length === 0) {
    console.error('Error: No task IDs provided.');
    return;
  }

  const tasks = loadTasks();
  let updatedCount = 0;

  ids.forEach(id => {
    const task = getTaskById(tasks, id);
    if (task) {
      task.status = 'closed';
      task.updated_at = new Date().toISOString();

      // Clear version if it is 'tbd'
      if (task.version === 'tbd') {
        task.version = '';
      }

      if (bodyText) {
        const newBody: TaskBody = {
          text: bodyText,
          created_at: new Date().toISOString()
        };
        task.bodies.push(newBody);
      }
      updatedCount++;
      console.log(`Task ${task.id} closed.`);
    } else {
      console.warn(`Task ${id} not found.`);
    }
  });

  if (updatedCount > 0) {
    saveTasks(tasks);
  }
}
