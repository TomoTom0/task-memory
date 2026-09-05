import { createHash } from 'crypto';
import { appendFileSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// 実データ不変guard（設計書: docs/design/test-isolation.md）。
// globalSetupはvitestメインプロセス内の別global scope（setup.tsによる環境差し替えの
// 影響を受けない。homedir()は実HOMEのまま）でrun前に一度だけ実行され、
// teardownはrunの正常完了時に一度だけ呼ばれる（teardownでのthrowはrunをexit code 1で失敗させる）
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type Target = { label: string; path: string };
type Snapshot = { state: 'absent' } | { state: 'present'; hash: string; entries: number };

// 監視対象5点。home側3点は固定、repo側2点は<repo>/.gitの実体（follow判定）で分岐する。
// worktree等で.gitが通常ファイルの場合、DBはrepo root直下に作られるため
// .git/配下固定の監視では検知漏れになる（本番コードのgetDbPath/getReviewDbPathと同じ挙動）
function buildTargets(): Target[] {
    const gitPath = join(REPO_ROOT, '.git');
    const repoDbDir = statSync(gitPath).isDirectory() ? gitPath : REPO_ROOT;
    return [
        { label: 'sync repo', path: join(homedir(), '.local', 'task-memory') },
        { label: 'global task DB', path: join(homedir(), '.task-memory.json') },
        { label: 'review memory', path: join(homedir(), '.review-memory.json') },
        { label: 'repo task DB', path: join(repoDbDir, 'task-memory.json') },
        { label: 'repo review DB', path: join(repoDbDir, 'review-memory.json') },
    ];
}

function fileSnapshot(path: string, mode: string): Snapshot {
    // 対象自身のmode（chmod検知）+ 内容のsha256
    const content = readFileSync(path);
    const hash = createHash('sha256').update(`${mode}\0`).update(content).digest('hex');
    return { state: 'present', hash, entries: 1 };
}

function symlinkSnapshot(path: string, mode: string): Snapshot {
    // symlinkはmode + ターゲット文字列のみをハッシュに入れ、リンク先の実体は再帰しない
    // （監視意図外の実体をハッシュ対象に取り込まない）
    const target = readlinkSync(path);
    const hash = createHash('sha256').update(`symlink\0${mode}\0${target}`).digest('hex');
    return { state: 'present', hash, entries: 1 };
}

function directorySnapshot(path: string, mode: string): Snapshot {
    // 構成+内容全体の再帰ハッシュ。種別判定はDirent（linkを辿らない）、mode取得は
    // lstatSync（statSyncやsymlinkを辿るwalkerは監視意図外の実体を取り込みうるため使わない）。
    // mtimeは含めない（読み取りやtouchによる偽陽性を避ける）。集計root自体のmodeも
    // relPathが空の行として含め、対象自身のchmodを検知する
    const lines: string[] = [`\0dir\0${mode}`];
    const walk = (current: string, rel: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const entryPath = join(current, entry.name);
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
            const mode = lstatSync(entryPath).mode.toString(8);
            if (entry.isDirectory()) {
                lines.push(`${relPath}\0dir\0${mode}`);
                walk(entryPath, relPath);
            } else if (entry.isFile()) {
                const fileHash = createHash('sha256').update(readFileSync(entryPath)).digest('hex');
                lines.push(`${relPath}\0file\0${mode}\0${fileHash}`);
            } else if (entry.isSymbolicLink()) {
                lines.push(`${relPath}\0symlink\0${mode}\0${readlinkSync(entryPath)}`);
            } else {
                lines.push(`${relPath}\0special\0${mode}`);
            }
        }
    };
    walk(path, '');
    // 行を相対パス辞書順にソートして連結し、全体のsha256をdirectory hashとする
    lines.sort();
    const hash = createHash('sha256').update(lines.join('\n')).digest('hex');
    return { state: 'present', hash, entries: lines.length };
}

// 存在しないことも状態の一部とする（absent -> present も不一致）
function snapshotPath(path: string): Snapshot {
    let stat: ReturnType<typeof lstatSync>;
    try {
        stat = lstatSync(path);
    } catch {
        return { state: 'absent' };
    }
    const mode = stat.mode.toString(8);
    if (stat.isFile()) return fileSnapshot(path, mode);
    if (stat.isDirectory()) return directorySnapshot(path, mode);
    if (stat.isSymbolicLink()) return symlinkSnapshot(path, mode);
    const hash = createHash('sha256').update(`special\0${mode}`).digest('hex');
    return { state: 'present', hash, entries: 1 };
}

function describeSnapshot(snap: Snapshot, path: string): string {
    if (snap.state === 'absent') return 'absent';
    try {
        if (lstatSync(path).isDirectory()) {
            return `${snap.hash.slice(0, 12)}...(${snap.entries} entries)`;
        }
    } catch {
        // 種別判定不能な場合はfile形式で表示する（検知はhash比較で行われるため影響しない）
    }
    return `present (sha256 ${snap.hash.slice(0, 6)}...)`;
}

export default function globalSetup(): () => Promise<void> {
    const targets = buildTargets();
    const before = new Map(targets.map((t) => [t.path, snapshotPath(t.path)] as const));

    // 受入専用プローブ（通常runでは未指定・何もしない）。
    // 「run中に実データが壊された」状況を安全に再現するため、before snapshot取得直後
    // （=beforeには健全な内容が記録済み）に指定pathへ1byte追記する。
    // runの前に手動で破壊するとglobalSetupが破壊後の内容をbeforeとして記録し、
    // guardが発火しなくなるため、破壊は必ずこのフック（snapshot直後・teardown前）経由とする
    const probe = process.env.TEST_ISOLATION_GUARD_PROBE_PATH;
    if (probe !== undefined) {
        // 誤指定で監視対象外の実ファイルを破壊しないよう、追記前に指定pathが監視対象5点の
        // いずれかと完全一致し、かつsnapshotがpresentであることを検証する
        // （不一致・absentなら追記前にthrowしてrunを落とす）
        const probeTarget = targets.find((t) => t.path === probe);
        const probeSnap = probeTarget !== undefined ? before.get(probeTarget.path) : undefined;
        if (probeTarget === undefined || probeSnap === undefined || probeSnap.state !== 'present') {
            throw new Error(`[test-isolation-guard] PROBE: path is not a present guarded target: ${probe}`);
        }
        appendFileSync(probe, 'x');
        console.error(`[test-isolation-guard] PROBE: appended 1 byte to ${probe} after snapshot (acceptance only)`);
    }

    return async () => {
        const problems: string[] = [];
        for (const t of targets) {
            const beforeSnap = before.get(t.path);
            const after = snapshotPath(t.path);
            if (beforeSnap !== undefined && JSON.stringify(after) !== JSON.stringify(beforeSnap)) {
                problems.push(
                    `${t.path} (${t.label})\n` +
                    `     before: ${describeSnapshot(beforeSnap, t.path)}\n` +
                    `     after:  ${describeSnapshot(after, t.path)}`
                );
            }
        }
        if (problems.length > 0) {
            console.error('[test-isolation-guard] 実データがテスト実行中に変更されました:');
            problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
            console.error('復旧: ./tmp/ のバックアップ（受入手順(a)）から復元してください。');
            throw new Error(`isolation guard failed: ${problems.length} path(s) changed`);
        }
        console.log('[test-isolation-guard] all guarded targets unchanged');
    };
}
