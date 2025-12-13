#!/usr/bin/env bun
import { newCommand } from './commands/new';
import { listCommand } from './commands/list';
import { getCommand } from './commands/get';
import { finishCommand } from './commands/finish';
import { updateCommand } from './commands/update';
import { envCommand } from './commands/env';
import { reviewCommand } from './commands/review';
import { releaseCommand } from './commands/release';
import { closeCommand } from './commands/close';

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

switch (command) {
  case 'new':
    newCommand(commandArgs);
    break;
  case 'list':
  case 'ls':
  case 'l':
    listCommand(commandArgs);
    break;
  case 'get':
  case 'g':
    getCommand(commandArgs);
    break;
  case 'finish':
  case 'fin':
  case 'f':
    finishCommand(commandArgs);
    break;
  case 'update':
  case 'up':
  case 'u':
    updateCommand(commandArgs);
    break;
  case 'env':
    envCommand(commandArgs);
    break;
  case 'review':
  case 'rev':
  case 'tmr':
    reviewCommand(commandArgs);
    break;
  case 'release':
    releaseCommand(commandArgs);
    break;
  case 'close':
    closeCommand(commandArgs);
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
      --goal, -g <text>        Set completion goal
      --body, -b <text>        Add initial body text
      --add-file, -a <path>    Add editable file
      --read-file, -r <path>   Add read-only file

  list (ls, l) [options]
    List active tasks (todo, wip).
    Options:
      --status-all, -a         Show all tasks (including done/closed)
      --open                   Show all open tasks (todo, wip, pending, long)
      --priority <p>           Filter by priority
      --status, -s <status>    Filter by status
      --version <v>            Filter by version
      --tbd                    Filter by version 'tbd' (includes closed/done)
      --released               Filter by released tasks (non-tbd version)
      --head [N]               Show first N tasks (default: 10)
      --tail [N]               Show last N tasks (default: 10)

  get (g) <id...> [options]
    Get task details (JSON).
    Options:
      --all, -a, --history, -h     Show full history of bodies

  finish (fin, f) <id...>
    Mark task(s) as done.

  update (up, u) <id...> [options]
    Update task(s). Supports context switching.
    Options:
      --status, -s <status>    Update status (todo, wip, done, pending, long, closed)
      --priority, -p <value>   Update priority
      --goal, -g <text>        Update completion goal
      --body, -b <text>        Append body text
      --add-file, -a <path>    Add editable file
      --rm-file, -d <path>     Remove editable file
      --read-file, -r <path>   Add read-only file

  env
    Show the current task data file path.

  review (rev, tmr) <subcommand> [args]
    Manage reviews.
    Subcommands: new, list, get, update, return, accept, reject

  release <id...> --version <v>
    Set version for task(s).

  close <id...> [--body <text>]
    Close task(s). Alias for update --status closed.

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
