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

  const bodyIndex = args.indexOf('--body');
  const bodyText = bodyIndex !== -1 ? args[bodyIndex + 1] : null;

  // Filter out options to get IDs
  const ids = args.filter(arg => !arg.startsWith('--') && arg !== bodyText);

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
