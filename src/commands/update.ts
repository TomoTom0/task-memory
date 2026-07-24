import { loadTasks, saveTasks, getTaskById, getCurrentCommit } from '../store';
import type { Task } from '../types';
import { isTaskStatus, canTransition, blockedExitMessage, TASK_STATUSES } from '../utils/statusGuard';

export function updateCommand(args: string[]): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm update <id...> [options]

Options:
  --status, -s <status>    Update status (todo, wip, done, pending, long, blocked, closed)
  --priority, -p <value>   Update priority
  --version, -v <value>    Update version
  --goal, -g <text>        Update completion goal
  --order, -o <value>      Update progress order (use 'null' to clear)
  --body, -b <text>        Append body text
  --add-file, -a <path>    Add editable file
  --rm-file, -d <path>     Remove editable file
  --read-file, -r <path>   Add read-only file
  --gate <text>            Set start condition (only with --status blocked)
  --force                  Allow transitioning a blocked task out of blocked
`);
        return;
    }

    // Pre-scan: --force はグローバルフラグ。各バッチ（コンテキストスイッチ区切り）ごとに
    // blocked/gate のペアリングを検証し、バッチごとの gate 値を収集する。
    // 値を取るオプションの値をスキップしないと "--gate A" の A が ID として誤認され、
    // バッチ境界がずれるため valueOpts でまとめて処理する。
    const force = args.includes('--force');
    const valueOpts = new Set([
        '--status', '-s', '--priority', '-p', '--version', '-v', '--goal', '-g',
        '--order', '-o', '--body', '-b', '--add-file', '-a', '--rm-file', '-d',
        '--read-file', '-r', '--gate'
    ]);
    const batchGate: string[] = [];      // batchIndex -> そのバッチの最後の gate 値
    const batchBlocked: boolean[] = [];  // batchIndex -> そのバッチに --status blocked があるか
    let batchCount = 0;
    let malformedGate = false;           // 値なし/不正値の --gate が一つでもあれば全体を拒否
    {
        let bi = 0;
        let lastOpt = false;
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (!a) continue;
            if (a.startsWith('-') && valueOpts.has(a)) {
                lastOpt = true;
                const val = args[i + 1];
                if (a === '--status' || a === '-s') {
                    if (val === 'blocked') batchBlocked[bi] = true;
                } else if (a === '--gate') {
                    if (val && !val.startsWith('-')) {
                        batchGate[bi] = val;
                    } else {
                        malformedGate = true;
                    }
                }
                i++; // 値をスキップ（for の i++ と合わせて2進む）
            } else if (a.startsWith('-')) {
                // 値を取らないオプション（--force / -h / 未知の単体）
                lastOpt = true;
            } else {
                // ID: 直前がオプションなら新バッチ開始
                if (lastOpt) { bi++; lastOpt = false; }
            }
        }
        batchCount = bi;
    }
    // malformed な --gate（値なし/別オプションが続く）は、いかなる変更も適用する前に
    // コマンド全体を拒否する。実行ループで事後的にエラーを出すと、それより前の
    // --priority 等の変更（あるいは --force による blocked の強制解除）が既に保存されてしまう。
    if (malformedGate) {
        console.error('Error: --gate requires a value.');
        return;
    }
    // 各バッチのペアリングを検証
    for (let b = 0; b <= batchCount; b++) {
        const blocked = batchBlocked[b] === true;
        const gate = batchGate[b];
        if (blocked && !gate) {
            console.error('Error: Setting status to "blocked" requires --gate "..." (the start condition). Prefer: tm block <id> --gate "..."');
            return;
        }
        if (gate && !blocked) {
            console.error('Error: --gate is only valid together with --status blocked. To update a blocked task\'s gate, use: tm block <id> --gate "..."');
            return;
        }
    }

    const tasks = loadTasks();
    let currentTargetIds: string[] = [];
    let updated = false;
    let lastActionWasOption = false;
    let batchIndex = 0;

    // Helper to apply updates to current targets
    const applyUpdate = (action: (task: Task) => boolean | void) => {
        if (currentTargetIds.length === 0) {
            console.error('Error: No task ID specified for update. Usage: tm update <id> [options] ...');
            return;
        }
        const commit = getCurrentCommit();
        for (const id of currentTargetIds) {
            const task = getTaskById(tasks, id);
            if (task) {
                // action が false を返した場合は拒否（例: blocked からの遷移）。updated_at/保存は行わない。
                if (action(task) === false) continue;
                task.updated_at = new Date().toISOString();
                task.updated_commit = commit;
                updated = true;
            } else {
                console.error(`Error: ID '${id}' not found.`);
            }
        }
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('-')) {
            // Option handling
            lastActionWasOption = true;
            switch (arg) {
                case '--status':
                case '-s':
                    const status = args[++i];
                    if (status && isTaskStatus(status)) {
                        applyUpdate(t => {
                            // blocked からの遷移は通常禁止（--force で突破可）
                            if (!canTransition(t.status, status)) {
                                if (!force) {
                                    console.error(blockedExitMessage(t));
                                    return false;
                                }
                                // force で blocked を抜ける場合は gate を解除
                                t.gate = undefined;
                            }
                            // blocked になる場合は gate を設定（pre-scan で収集したバッチごとの値）
                            if (status === 'blocked' && batchGate[batchIndex]) {
                                t.gate = batchGate[batchIndex];
                            }
                            t.status = status;
                            // todo, wip 以外に変更したら order を null にする
                            if (status !== 'todo' && status !== 'wip') {
                                t.order = null;
                            }
                        });
                    } else {
                        console.error(`Error: Invalid status '${status}'. Allowed: ${TASK_STATUSES.join(', ')}.`);
                    }
                    break;
                case '--priority':
                case '-p':
                    const priority = args[++i];
                    if (priority) {
                        applyUpdate(t => t.priority = priority);
                    } else {
                        console.error('Error: --priority requires a value.');
                    }
                    break;
                case '--version':
                case '-v':
                    const version = args[++i];
                    if (version) {
                        applyUpdate(t => t.version = version);
                    } else {
                        console.error('Error: --version requires a value.');
                    }
                    break;
                case '--goal':
                case '-g':
                    const goal = args[++i];
                    if (goal) {
                        applyUpdate(t => t.goal = goal);
                    } else {
                        console.error('Error: --goal requires a value.');
                    }
                    break;
                case '--order':
                case '-o':
                    const order = args[++i];
                    if (order) {
                        applyUpdate(t => {
                            // todo, wip のみ order を設定可能
                            if (t.status === 'todo' || t.status === 'wip') {
                                t.order = order === 'null' ? null : order;
                            } else {
                                console.error(`Error: Cannot set order for task with status '${t.status}'. Only todo/wip allowed.`);
                            }
                        });
                    } else {
                        console.error('Error: --order requires a value.');
                    }
                    break;
                case '--body':
                case '-b':
                    const bodyText = args[++i];
                    if (bodyText) {
                        applyUpdate(t => t.bodies.push({
                            text: bodyText,
                            created_at: new Date().toISOString()
                        }));
                    } else {
                        console.error('Error: --body requires a text argument.');
                    }
                    break;
                case '--add-file':
                case '-a':
                    const addPath = args[++i];
                    if (addPath) {
                        applyUpdate(t => {
                            if (!t.files.edit.includes(addPath)) {
                                t.files.edit.push(addPath);
                            }
                        });
                    } else {
                        console.error('Error: --add-file requires a path argument.');
                    }
                    break;
                case '--rm-file':
                case '-d':
                    const rmPath = args[++i];
                    if (rmPath) {
                        applyUpdate(t => {
                            t.files.edit = t.files.edit.filter(p => p !== rmPath);
                        });
                    } else {
                        console.error('Error: --rm-file requires a path argument.');
                    }
                    break;
                case '--read-file':
                case '-r':
                    const readPath = args[++i];
                    if (readPath) {
                        applyUpdate(t => {
                            if (!t.files.read.includes(readPath)) {
                                t.files.read.push(readPath);
                            }
                        });
                    } else {
                        console.error('Error: --read-file requires a path argument.');
                    }
                    break;
                case '--gate':
                    // 値は pre-scan で検証済み（malformed は事前拒否済み）。ここでは値を消費するのみ。
                    // 適用は --status blocked ケースで batchGate[batchIndex] を使って行う。
                    i++;
                    break;
                case '--force':
                    // pre-scan で処理済み。ここでは消費のみ。
                    break;
                default:
                    console.error(`Error: Unknown option '${arg}'.`);
                    return;
            }
        } else {
            // ID handling
            if (lastActionWasOption) {
                currentTargetIds = [];
                lastActionWasOption = false;
                batchIndex++;
            }
            // Assume anything not starting with -- is an ID (or invalid garbage, but we treat as ID for lookup)
            // The spec says "ID (numeric or TASK-n)". 
            // We can be loose and try to use it as ID.
            currentTargetIds.push(arg);
        }
    }

    if (updated) {
        saveTasks(tasks);
        console.log('Tasks updated.');
    }
}
