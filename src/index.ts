#!/usr/bin/env bun
import { newCommand } from './commands/new';
import { listCommand } from './commands/list';
import { getCommand } from './commands/get';
import { finishCommand } from './commands/finish';
import { updateCommand } from './commands/update';
import { envCommand } from './commands/env';
import { reviewCommand } from './commands/review';

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

switch (command) {
  case 'new':
    newCommand(commandArgs);
    break;
  case 'list':
    listCommand();
    break;
  case 'get':
    getCommand(commandArgs);
    break;
  case 'finish':
    finishCommand(commandArgs);
    break;
  case 'update':
    updateCommand(commandArgs);
    break;
  case 'env':
    envCommand();
    break;
  case 'review':
  case 'rev':
  case 'tmr':
    reviewCommand(commandArgs);
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(`
Usage: tm <command> [args]

Commands:
  new <summary> [options]
    Create a new task.
    Options:
      --status, -s <status>    Set initial status (todo, wip, done, pending, long, closed)
      --priority, -p <value>   Set priority
      --body, -b <text>        Add initial body text
      --add-file, -a <path>    Add editable file
      --read-file, -r <path>   Add read-only file

  list
    List active tasks (todo, wip, pending, long).

  get <id...> [options]
    Get task details (JSON).
    Options:
      --all, -a, --history, -h     Show full history of bodies

  finish <id...>
    Mark task(s) as done.

  update <id...> [options]
    Update task(s). Supports context switching.
    Options:
      --status, -s <status>    Update status (todo, wip, done, pending, long, closed)
      --priority, -p <value>   Update priority
      --body, -b <text>        Append body text
      --add-file, -a <path>    Add editable file
      --rm-file, -d <path>     Remove editable file
      --read-file, -r <path>   Add read-only file

  env
    Show the current task data file path.

  review <subcommand> [args]
    Manage reviews.
    Subcommands: new, list, get, update, return, accept, reject

Examples:
  tm new "Refactor auth" --status wip --body "Starting now" --priority high
  tm update 1 --status done 2 --status wip --body "Fixing bug"
  tm get 1 --history
    `);
    break;
  default:
    // If no command provided, show help
    if (!command) {
      console.log(`
Usage: tm <command> [args]

Run 'tm help' for detailed usage and examples.
        `);
    } else {
      console.error(`Error: Unknown command '${command}'. Run 'tm help' for usage.`);
      process.exit(1);
    }
}
