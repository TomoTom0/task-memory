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

// Stats型（lstatSync・statSyncの戻り値。型安全規約に従いasキャストせずReturnTypeで受ける）
type StatsLike = ReturnType<typeof lstatSync>;

function fileLine(path: string, rel: string, mode: string): string {
    // 対象自身のmode（chmod検知）+ 内容のsha256
    const contentHash = createHash('sha256').update(readFileSync(path)).digest('hex');
    return `${rel}\0file\0${mode}\0${contentHash}`;
}

// 「このpathへ書き込みが届くものすべて」を行列表現にする。本番コードの書き込み
// （writeFileSync等・子プロセスgit）はsymlinkを辿って参照実体へ届くため、link自身の
// 情報に加えて参照実体も行に含める（リンクテキストのみでは実体の変更を検知できない）。
// mtimeは含めない（読み取りやtouchによる偽陽性を避ける）
function snapshotLines(path: string, rel: string, visitedDirs: Set<string>): string[] {
    let stat: StatsLike;
    try {
        stat = lstatSync(path);
    } catch {
        return [`${rel}\0absent`];
    }
    const mode = stat.mode.toString(8);
    if (stat.isFile()) return [fileLine(path, rel, mode)];
    if (stat.isDirectory()) return directoryLines(path, rel, stat, visitedDirs);
    if (stat.isSymbolicLink()) return symlinkLines(path, rel, mode, visitedDirs);
    return [`${rel}\0special\0${mode}`];
}

function directoryLines(path: string, rel: string, stat: StatsLike, visitedDirs: Set<string>): string[] {
    // 構成+内容全体の再帰ハッシュ用の行。種別判定はDirent（linkを辿らない）、mode取得は
    // lstatSync。集計root自体のmodeもrelPathが空の行として含め、対象自身のchmodを検知する。
    // 同一実体（dev:ino）の再訪はsymlink loop等による無限再帰を防ぐためmarker行で打ち切り、
    // 子の走査は名前順で行いmarker行の現れ方を決定化する（visitedDirsの状態に行内容が依存し、
    // 最終sortだけでは決定化できないため）
    const dirKey = `${stat.dev}:${stat.ino}`;
    if (visitedDirs.has(dirKey)) return [`${rel}\0dir-cycle\0${stat.mode.toString(8)}`];
    visitedDirs.add(dirKey);
    const lines: string[] = [`${rel}\0dir\0${stat.mode.toString(8)}`];
    const entries = readdirSync(path, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
        lines.push(...snapshotLines(join(path, entry.name), entryRel, visitedDirs));
    }
    return lines;
}

function symlinkLines(path: string, rel: string, mode: string, visitedDirs: Set<string>): string[] {
    // link自身はmode + ターゲット文字列（retarget検知）。参照実体は`${rel}/` prefix（top-levelは
    // rel=''のまま）の配下の行として辿る。参照実体が解決できない（broken link・loop）場合は
    // 「absent」行として固定し、run中にlink越しに実体が作られれば不一致として検知する。
    // 参照実体がfifo等のspecialの場合は内容を読まない（blockしうるため種別+modeのみ）
    const target = readlinkSync(path);
    const lines = [`${rel}\0symlink\0${mode}\0${target}`];
    const referentRel = rel === '' ? '' : `${rel}/`;
    let referentStat: StatsLike;
    try {
        referentStat = statSync(path);
    } catch {
        return [...lines, `${referentRel}\0absent`];
    }
    const referentMode = referentStat.mode.toString(8);
    if (referentStat.isFile()) {
        lines.push(fileLine(path, referentRel, referentMode));
    } else if (referentStat.isDirectory()) {
        lines.push(...directoryLines(path, referentRel, referentStat, visitedDirs));
    } else {
        lines.push(`${referentRel}\0special\0${referentMode}`);
    }
    return lines;
}

// 存在しないことも状態の一部とする（absent -> present も不一致）
export function snapshotPath(path: string): Snapshot {
    const lines = snapshotLines(path, '', new Set());
    if (lines.length === 1 && lines[0] === '\0absent') return { state: 'absent' };
    // 行を相対パス辞書順にソートして連結し、全体のsha256をhashとする
    lines.sort();
    const hash = createHash('sha256').update(lines.join('\n')).digest('hex');
    return { state: 'present', hash, entries: lines.length };
}

function describeSnapshot(snap: Snapshot, path: string): string {
    if (snap.state === 'absent') return 'absent';
    try {
        // symlink対象は参照実体をhash対象に含めるため、表示の種別判定もlinkを辿る
        if (statSync(path).isDirectory()) {
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
