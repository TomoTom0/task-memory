#!/usr/bin/env bun
import { newCommand } from './commands/new';
import { listCommand } from './commands/list';
import { getCommand } from './commands/get';
import { finishCommand } from './commands/finish';
import { updateCommand } from './commands/update';

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
    case 'help':
    case '--help':
    case '-h':
        console.log(`
Usage: tm <command> [args]

Commands:
  new <summary> [options]
    Create a new task.
    Options:
      --status <status>    Set initial status (todo, wip, done)
      --body <text>        Add initial body text
      --add-file <path>    Add editable file
      --read-file <path>   Add read-only file

  list
    List active tasks (todo, wip).

  get <id...> [options]
    Get task details (JSON).
    Options:
      --all, --history     Show full history of bodies

  finish <id...>
    Mark task(s) as done.

  update <id...> [options]
    Update task(s). Supports context switching.
    Options:
      --status <status>    Update status
      --body <text>        Append body text
      --add-file <path>    Add editable file
      --rm-file <path>     Remove editable file
      --read-file <path>   Add read-only file

Examples:
  tm new "Refactor auth" --status wip --body "Starting now"
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
