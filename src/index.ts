import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { newCommand } from './commands/new';
import { listCommand } from './commands/list';
import { getCommand } from './commands/get';
import { finishCommand } from './commands/finish';
import { updateCommand } from './commands/update';
import { envCommand } from './commands/env';
import { reviewCommand } from './commands/review';
import { releaseCommand } from './commands/release';
import { blockCommand } from './commands/block';
import { unblockCommand } from './commands/unblock';
import { closeCommand } from './commands/close';
import { syncCommand } from './commands/sync';
import { gitCommand } from './commands/git';
import { docsCommand } from './commands/docs';
import { setAfterSaveCallback, setGlobalMode, NotGitError } from './store';
import { tryAutoSync } from './syncStore';

// 自動同期コールバックを設定
setAfterSaveCallback((store) => {
    tryAutoSync(store.sync, store);
});

/**
 * `tm help` / `tm --help` で表示するヘルプテキスト。
 * テストから検証可能なよう純粋関数として切り出している。
 */
export function getHelpText(): string {
    return `
Usage: tm [--global] <command> [args]

Global options:
  --global, -G             Use home directory for storage (for non-git environments)

Commands:
  new <summary> [options]
    Create a new task.
    Options:
      --status, -s <status>    Set initial status (todo, wip, done, pending, long, blocked, closed)
      --priority, -p <value>   Set priority
      --goal, -g <text>        Set completion goal
      --gate <text>            Set start condition (required if status is blocked)
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
      --sort <key>             Sort by: order (default), id, created
      --head [N]               Show first N tasks (default: 10)
      --tail [N]               Show last N tasks (default: 10)

  get (g) <id...> [options]
    Get task details (JSON).
    Options:
      --all, -a, --history     Show full history of bodies
      --last <N>               Show first and last N-1 bodies (total N)

  finish (fin, f) <id...>
    Mark task(s) as done.

  update (up, u) <id...> [options]
    Update task(s). Supports context switching.
    Options:
      --status, -s <status>    Update status (todo, wip, done, pending, long, blocked, closed)
      --priority, -p <value>   Update priority
      --version, -v <value>    Update version
      --goal, -g <text>        Update completion goal
      --order, -o <value>      Update progress order (use 'null' to clear)
      --gate <text>            Set start condition (only with --status blocked)
      --force                  Allow transitioning a blocked task out of blocked
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

  block <id...> --gate "..."
    Mark task(s) as blocked (cannot resume until gate is satisfied).

  unblock <id...> [--status todo|wip]
    Clear the gate and resume a blocked task (default target: todo).

  sync <subcommand> [options]
    Sync tasks to ~/.local/task-memory/ repository.
    Subcommands: add, remove, push, pull, set, status, list

  git <git-command> [args]
    Run git commands in ~/.local/task-memory/ repository.

  docs [page]
    Show documentation. Pages: usage (default), agent-claude-md, agent-guide

Examples:
  tm new "Refactor auth" --status wip --body "Starting now" --priority high
  tm update 1 --status done 2 --status wip --body "Fixing bug"
  tm get 1 --history
`;
}

/**
 * コマンドを振り分ける。コマンド名と残りの引数を受け取り、対応するコマンド関数を呼ぶ。
 * 未知コマンドや引数なしの場合はメッセージを出力する。
 */
export function dispatch(command: string | undefined, commandArgs: string[]): void {
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
        case 'block':
            blockCommand(commandArgs);
            break;
        case 'unblock':
            unblockCommand(commandArgs);
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
        case 'sync':
            syncCommand(commandArgs);
            break;
        case 'git':
            gitCommand(commandArgs);
            break;
        case 'docs':
            docsCommand(commandArgs);
            break;
        case 'help':
        case '--help':
        case '-h':
            console.log(getHelpText());
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
}

/**
 * CLI エントリポイント。argv を解析して dispatch に渡す。
 */
function main(): void {
    const args = process.argv.slice(2);

    // --global / -G フラグを抽出（先頭引数のみチェック）
    if (args[0] === '--global' || args[0] === '-G') {
        setGlobalMode(true);
        args.shift();
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    try {
        dispatch(command, commandArgs);
    } catch (err: unknown) {
        if (err instanceof NotGitError) {
            console.error(err.message);
            process.exit(1);
        }
        throw err;
    }
}

// 直接実行されたか判定。symlink 経由（npm/pnpm の global bin install）でも
// 正しく検出するため、実行パスとモジュールパスをそれぞれ realpath で解決して比較する。
// 従来は pathToFileURL(process.argv[1]).href === import.meta.url だったが、
// symlink 実行時は process.argv[1] がリンクパス・import.meta.url が実パスになり
// 不一致で main() が起動せず、インストール版の全コマンドがサイレント終了していた。
export function isMainEntry(argv1: string | undefined, moduleUrl: string): boolean {
    if (!argv1) return false;
    try {
        return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
    } catch {
        return false;
    }
}

const invokedDirectly = isMainEntry(process.argv[1], import.meta.url);

if (invokedDirectly) {
    main();
}
