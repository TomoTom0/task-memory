import { join, basename, dirname, resolve, sep } from 'path';
import { homedir, tmpdir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, mkdtempSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import type { TaskStore, SyncConfig } from './types';

export interface SyncGlobalConfig {
    defaultAuto: boolean;
}

export function getSyncDir(): string {
    return join(homedir(), '.local', 'task-memory');
}

export function getProjectsDir(): string {
    return join(getSyncDir(), 'projects');
}

function getConfigFile(): string {
    return join(getSyncDir(), 'config.json');
}

export type SyncDirState = 'initialized' | 'not-git' | 'absent';

export function getSyncDirState(): SyncDirState {
    const syncDir = getSyncDir();
    if (!existsSync(syncDir)) return 'absent';
    if (!existsSync(join(syncDir, '.git'))) return 'not-git';
    return 'initialized';
}

export function isSyncInitialized(): boolean {
    return getSyncDirState() === 'initialized';
}

export function initSyncRepo(): boolean {
    const syncDir = getSyncDir();
    const projectsDir = getProjectsDir();
    if (!existsSync(syncDir)) {
        mkdirSync(syncDir, { recursive: true });
    }
    if (!existsSync(projectsDir)) {
        mkdirSync(projectsDir, { recursive: true });
    }

    // git init
    if (!existsSync(join(syncDir, '.git'))) {
        const result = spawnSync('git', ['init'], { cwd: syncDir, stdio: 'inherit' });
        if (result.status !== 0) {
            console.error('Failed to initialize git repository');
            return false;
        }
    }

    // config.json を作成
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
        const config: SyncGlobalConfig = { defaultAuto: false };
        writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    }

    return true;
}

export function loadGlobalConfig(): SyncGlobalConfig {
    const configFile = getConfigFile();
    if (!existsSync(configFile)) {
        return { defaultAuto: false };
    }
    try {
        const data = readFileSync(configFile, 'utf-8');
        return JSON.parse(data) as SyncGlobalConfig;
    } catch (e) {
        return { defaultAuto: false };
    }
}

export function saveGlobalConfig(config: SyncGlobalConfig): void {
    writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export function getProjectFilePath(syncId: string): string {
    return join(getProjectsDir(), `${syncId}.json`);
}

export function isValidSyncId(id: string): boolean {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return false;
    if (id === '.' || id === '..') return false;
    const resolved = resolve(getProjectFilePath(id));
    const projectsDir = resolve(getProjectsDir()) + sep;
    return resolved.startsWith(projectsDir);
}

export function isSafeGitUrl(url: string): boolean {
    // <transport>::<address> は git remote helper 構文（例: ext::sh -c '...'）で、
    // 任意の helper を起動し得る。一方、SSH URL 内の IPv6 リテラルにも :: は
    // 含まれるため、先頭の transport 部分だけを拒否する。
    return url.length > 0 && !url.startsWith('-') && !/^[A-Za-z][A-Za-z0-9+.-]*::/.test(url);
}

export function ensureProjectsDir(): void {
    mkdirSync(getProjectsDir(), { recursive: true });
}

export function cloneSyncRepo(url: string): number {
    const syncDir = getSyncDir();
    mkdirSync(dirname(syncDir), { recursive: true });
    const result = spawnSync('git', ['clone', '--', url, syncDir], { stdio: 'inherit' });
    return result.status ?? 1;
}

export function saveToSync(syncId: string, store: TaskStore): boolean {
    if (!isValidSyncId(syncId)) {
        console.error(`Invalid sync id: ${syncId}`);
        return false;
    }

    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return false;
    }

    const projectFile = getProjectFilePath(syncId);

    try {
        writeFileSync(projectFile, JSON.stringify(store, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.error(`Failed to save to sync: ${e}`);
        return false;
    }
}

export function tryAutoSync(syncConfig: SyncConfig | undefined, store: TaskStore): void {
    if (!syncConfig?.enabled || !syncConfig.auto) {
        return;
    }

    if (!isSyncInitialized()) {
        return;
    }

    saveToSync(syncConfig.id, store);
}

export function pullFromSync(syncId: string): TaskStore | null {
    if (!isValidSyncId(syncId)) {
        console.error(`Invalid sync id: ${syncId}`);
        return null;
    }

    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return null;
    }

    const projectFile = getProjectFilePath(syncId);

    if (!existsSync(projectFile)) {
        console.error(`Project "${syncId}" not found in sync repository.`);
        console.error('Run "tm sync list" to see available projects.');
        console.error('Run "tm sync set --id <name>" to use a different ID for this project.');
        return null;
    }

    try {
        const data = readFileSync(projectFile, 'utf-8');
        return JSON.parse(data) as TaskStore;
    } catch (e) {
        console.error(`Failed to pull from sync: ${e}`);
        return null;
    }
}

export function hasSyncProject(syncId: string): boolean {
    if (!isValidSyncId(syncId)) return false;
    return existsSync(getProjectFilePath(syncId));
}

export function listSyncedProjects(): string[] {
    const projectsDir = getProjectsDir();
    if (!existsSync(projectsDir)) {
        return [];
    }

    const files = readdirSync(projectsDir) as string[];
    return files
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => f.replace(/\.json$/, ''));
}

export function runGitCommand(args: string[], captureOutput = false): number {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return 1;
    }

    const stdio = captureOutput ? 'pipe' : 'inherit';
    const result = spawnSync('git', args, { cwd: getSyncDir(), encoding: captureOutput ? 'utf-8' : undefined, stdio });
    return result.status ?? 1;
}

export function runGitCommandCapture(args: string[]): { status: number; stdout: string; stderr: string } {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync add" first.');
        return { status: 1, stdout: '', stderr: 'Sync repository not initialized' };
    }

    const result = spawnSync('git', args, { cwd: getSyncDir(), encoding: 'utf-8', stdio: 'pipe' });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

export function getSyncRemoteUrl(): string | null {
    if (!isSyncInitialized()) return null;
    const result = runGitCommandCapture(['remote', 'get-url', 'origin']);
    if (result.status !== 0) return null;
    const url = result.stdout.trim();
    return url.length > 0 ? url : null;
}

export function hasSyncCommits(): boolean {
    if (!isSyncInitialized()) return false;
    return runGitCommandCapture(['rev-parse', '--verify', 'HEAD']).status === 0;
}

// 同期対象（projects/ 配下）の外にある追跡済みパスを git ls-files で列挙する。
// 旧版の git add . や tm git 経由の stage で projects/ 外が追跡済みのまま残っている
// repo の検出に使う（同期対象の限定: projects/ のみ）。ls-files が失敗した場合は空配列。
export function listTrackedPathsOutsideProjects(): string[] {
    const result = runGitCommandCapture(['ls-files']);
    if (result.status !== 0) {
        return [];
    }
    return result.stdout.split('\n').filter(p => p !== '' && !p.startsWith('projects/'));
}

export interface LocalFileSyncSnapshot {
    relativePath: string;
    content: Buffer;
}

// remote 側の削除 commit（同期対象の限定: projects/ のみ）が projects/ 外の追跡済み
// ローカルファイルを作業ツリーから消すのを防ぐため、pull 前に内容を保存する。
// git rm --cached は commit を作る側のクライアントしか保護しないため、受信側の
// 保護はこの snapshot と復元（restoreMissingFilesOutsideProjects）が担う。
export function snapshotFilesOutsideProjects(): LocalFileSyncSnapshot[] {
    const snapshot: LocalFileSyncSnapshot[] = [];
    for (const relativePath of listTrackedPathsOutsideProjects()) {
        const absolutePath = join(getSyncDir(), relativePath);
        if (existsSync(absolutePath)) {
            snapshot.push({ relativePath, content: readFileSync(absolutePath) });
        }
    }
    return snapshot;
}

// snapshot のうち pull 後に作業ツリーから消えていたファイルを書き戻す。
// 復元したファイルは untracked となり、同期対象（projects/ のみ）の外のため
// 以後の push には含まれない。復元した相対パスを返す。
export function restoreMissingFilesOutsideProjects(snapshot: LocalFileSyncSnapshot[]): string[] {
    const restored: string[] = [];
    for (const entry of snapshot) {
        const absolutePath = join(getSyncDir(), entry.relativePath);
        if (!existsSync(absolutePath)) {
            // 削除 commit の適用で nested path の親ディレクトリごと消えている場合が
            // あるため、書き戻し前に再生成する（PR#46レビュー指摘対応: 親ディレクトリ
            // 不存在による ENOENT で pull 済みのローカルファイルを復元できなくなるのを防ぐ）
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, entry.content);
            restored.push(entry.relativePath);
        }
    }
    return restored;
}

export type AdoptResult =
    | { kind: 'adopted'; branch: string }
    | { kind: 'remote-empty' }
    | { kind: 'fetch-failed'; stderr: string }
    | { kind: 'checkout-failed'; stderr: string };

// remote HEAD の symref（remote既定branch名）を ls-remote --symref で解決する。
// 広告されていない場合・ls-remote が失敗した場合は null。
// ローカル（file/path transport）の git は dangling HEAD を広告しないため、
// 「remote HEAD が実在しない branch を指す」状態では null が返る。
export function getRemoteDefaultBranch(): string | null {
    const result = runGitCommandCapture(['ls-remote', '--symref', 'origin', 'HEAD']);
    if (result.status !== 0) {
        return null;
    }
    const match = result.stdout.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m);
    return match?.[1] ?? null;
}

// ls-remote --heads の出力（<sha>\trefs/heads/<name> 行）を branch 名の集合に parse する
export function parseRemoteHeadBranches(output: string): Set<string> {
    const branches = new Set<string>();
    for (const line of output.split('\n')) {
        const ref = line.split('\t')[1];
        if (typeof ref === 'string' && ref.startsWith('refs/heads/')) {
            branches.add(ref.slice('refs/heads/'.length));
        }
    }
    return branches;
}

// ls-remote --heads origin の結果を実在する remote 側 branch 名の集合として返す。
// 失敗した場合は null。
export function getRemoteHeadBranches(): Set<string> | null {
    const result = runGitCommandCapture(['ls-remote', '--heads', 'origin']);
    if (result.status !== 0) {
        return null;
    }
    return parseRemoteHeadBranches(result.stdout);
}

// 空 remote の unborn HEAD 広告を probe clone で判別するための sentinel。remote が
// unborn HEAD の symref-target を広告しない場合、clone はこの名前を既定branchとして
// 使うため、この名前が返ってきたら「広告が無い」と判定できる
const UNBORN_PROBE_SENTINEL_BRANCH = 'tm-sync-unborn-probe';

// probe clone の symbolic-ref HEAD 出力から、remote の unborn HEAD が広告した既定branch名を
// 取る。sentinel（= 広告なし）・refs/heads/<name> 形式でない出力の場合は null
export function unbornBranchFromProbeSymref(output: string): string | null {
    const match = output.trim().match(/^refs\/heads\/(\S+)$/);
    const branch = match?.[1];
    if (branch === undefined || branch === UNBORN_PROBE_SENTINEL_BRANCH) {
        return null;
    }
    return branch;
}

// 空 remote の unborn HEAD が指す既定branch名を、git clone の probe で取得する。
// ls-remote は unborn HEAD の symref-target を出力しない（オブジェクトが存在しないため。
// PR#47レビュー指摘で確認）が、git clone は protocol v2 の unborn 広告を消費して clone 先の
// HEAD をその名前に設定する。空 remote の --bare clone は軽量なため、これを probe として
// 使う。広告が無い（古い git の server/client）・clone が失敗した場合は null を返し、
// 呼び出し側は rename を行わない（その場合は受信側の復旧で吸収される）。
export function probeRemoteUnbornDefaultBranch(remoteUrl: string | null): string | null {
    if (remoteUrl === null || !isSafeGitUrl(remoteUrl)) return null;
    if (!isSyncInitialized()) return null;
    const probeDir = mkdtempSync(join(tmpdir(), 'tm-sync-probe-'));
    try {
        // -c init.defaultBranch=<sentinel>: 広告が無い場合の clone 先 HEAD を sentinel に
        // 固定し、広告有無を区別できるようにする。cwd は sync repo（相対URLの解決先を
        // 他の git 操作と揃えるため）
        const cloneResult = spawnSync('git', [
            '-c', `init.defaultBranch=${UNBORN_PROBE_SENTINEL_BRANCH}`,
            'clone', '--bare', '--quiet', remoteUrl, probeDir,
        ], { cwd: getSyncDir(), encoding: 'utf-8', stdio: 'pipe' });
        if (cloneResult.status !== 0) return null;
        const symrefResult = spawnSync('git', ['symbolic-ref', 'HEAD'], { cwd: probeDir, encoding: 'utf-8', stdio: 'pipe' });
        if (symrefResult.status !== 0) return null;
        return unbornBranchFromProbeSymref(symrefResult.stdout);
    } finally {
        rmSync(probeDir, { recursive: true, force: true });
    }
}

export type RemoteSyncBranchDecision =
    | { kind: 'branch'; branch: string; note: string | null }
    | { kind: 'remote-empty' }
    | { kind: 'ambiguous'; stderr: string };

// remote の HEAD symref が指す branch 名（広告されていない場合は null）と実在する
// head branch の集合から、adopt / pull が使うべき branch を決定する。
//   - symref が実在する branch を指す場合: その branch（note は null）
//   - symref が無い・指す先に commit が無い場合で head が1本のみ: その1本
//     （ローカルと remote の git 既定 branch 名の不一致で最初の push が別名の branch に
//     行われた状態の復旧。PR#46レビュー指摘対応）
//   - head が0本: remote-empty（symref が未実在の branch を指す unborn 広告で commit が
//     1つも無い場合を含む）
//   - head が複数: どれを採用すべきか安全に判断できないため ambiguous
export function resolveRemoteSyncBranch(symrefBranch: string | null, headBranches: Set<string>): RemoteSyncBranchDecision {
    const sole = headBranches.size === 1 ? [...headBranches][0] ?? null : null;
    if (symrefBranch === null) {
        if (headBranches.size === 0) return { kind: 'remote-empty' };
        if (sole !== null) {
            return { kind: 'branch', branch: sole, note: `Remote HEAD is not advertised; using the sole branch "${sole}".` };
        }
        return { kind: 'ambiguous', stderr: 'Remote has branches but its default HEAD does not point to one. Set the remote HEAD, then retry.' };
    }
    if (!headBranches.has(symrefBranch)) {
        if (headBranches.size === 0) return { kind: 'remote-empty' };
        if (sole !== null) {
            return { kind: 'branch', branch: sole, note: `Remote HEAD points to "${symrefBranch}" which has no commits; using the sole branch "${sole}".` };
        }
        return { kind: 'ambiguous', stderr: `Remote HEAD points to "${symrefBranch}" which has no commits, and multiple branches exist. Set the remote HEAD, then retry.` };
    }
    return { kind: 'branch', branch: symrefBranch, note: null };
}

// push 前にローカルの現在 branch を remote 既定 branch 名へ rename すべきかを判定する。
// 条件: remote 既定 branch 名が判明しており（通常は HEAD symref の広告。空 remote の
// unborn HEAD に対しては probeRemoteUnbornDefaultBranch のprobe。ls-remote 単体では
// unborn HEAD の広告は取れない）・remote にまだ実在せず・ローカルの現在 branch 名と
// 異なる場合。この状態でそのまま push すると remote HEAD は実在しない branch
// を指したままとなり、他PCの clone / adopt / pull が破綻するため、rename してから
// push することで remote HEAD の指す先を埋める（PR#46レビュー指摘対応）。
// rename 不要・できない場合は null を返す。
export function shouldRenameLocalBranchToRemoteDefault(localBranch: string, remoteDefaultBranch: string | null, remoteHeadBranches: Set<string> | null): string | null {
    if (remoteDefaultBranch === null) return null;
    if (remoteHeadBranches === null) return null;
    if (remoteHeadBranches.has(remoteDefaultBranch)) return null;
    if (remoteDefaultBranch === localBranch) return null;
    // branch名はremote由来の値をgit引数へ渡すため、URLと同じ境界で検証する
    if (!isSafeGitUrl(remoteDefaultBranch)) return null;
    return remoteDefaultBranch;
}

function backupFilePath(path: string): string {
    let candidate = `${path}.bak-${Date.now()}`;
    let n = 1;
    while (existsSync(candidate)) {
        candidate = `${path}.bak-${Date.now()}-${n}`;
        n++;
    }
    return candidate;
}

function ensureBackupExcluded(): void {
    const excludePath = join(getSyncDir(), '.git', 'info', 'exclude');
    const pattern = '*.bak-*';
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    if (!current.split('\n').includes(pattern)) {
        writeFileSync(excludePath, current.replace(/\n?$/, '\n') + pattern + '\n', 'utf-8');
    }
}

// 前提: isSyncInitialized() && !hasSyncCommits() && getSyncRemoteUrl() !== null
// （呼び出し側でこの3条件を満たす場合のみ呼ぶ）
export function adoptRemoteIntoEmptyRepo(): AdoptResult {
    const syncDir = getSyncDir();

    const headsResult = runGitCommandCapture(['ls-remote', '--heads', 'origin']);
    if (headsResult.status !== 0) {
        return { kind: 'fetch-failed', stderr: headsResult.stderr };
    }
    const decision = resolveRemoteSyncBranch(getRemoteDefaultBranch(), parseRemoteHeadBranches(headsResult.stdout));
    if (decision.kind === 'remote-empty') {
        return { kind: 'remote-empty' };
    }
    if (decision.kind === 'ambiguous') {
        // head が複数ありどれを採用すべきか安全に判断できないため、remote の HEAD を
        // 修復してもらうまで adopt は行わない
        return { kind: 'fetch-failed', stderr: decision.stderr };
    }
    if (decision.note !== null) {
        console.log(decision.note);
    }
    // isSafeGitUrl()は「-始まり/::を含む文字列をgit引数へ渡さない」判定として汎用的に使える。
    // branchはremoteから受け取った値をfetch/checkoutへそのまま渡すため、URLと同じ境界で検証する
    // （コードレビュー指摘対応: '-'始まりのbranch名がgitオプションと誤解釈されるのを防ぐ）
    if (!isSafeGitUrl(decision.branch)) {
        return { kind: 'fetch-failed', stderr: `Unsafe branch name from remote: "${decision.branch}"` };
    }
    const branch = decision.branch;

    const fetchResult = runGitCommandCapture(['fetch', 'origin', branch]);
    if (fetchResult.status !== 0) {
        return { kind: 'fetch-failed', stderr: fetchResult.stderr };
    }

    // ブートストラップファイル（config.json / .gitignore）が未追跡なら退避する。
    // projects/配下は対象外: 衝突すればcheckoutが失敗し非破壊のまま通知される。
    const backedUp: string[] = [];
    for (const name of ['config.json', '.gitignore']) {
        const path = join(syncDir, name);
        const statusResult = runGitCommandCapture(['status', '--porcelain', '--', name]);
        if (statusResult.stdout.startsWith('??')) {
            const backupPath = backupFilePath(path);
            renameSync(path, backupPath);
            backedUp.push(backupPath);
        }
    }
    if (backedUp.length > 0) {
        ensureBackupExcluded();
        console.log(`Backed up local bootstrap files before adopting remote data: ${backedUp.join(', ')}`);
    }

    const checkoutResult = runGitCommandCapture(['checkout', '-B', branch, `origin/${branch}`]);
    if (checkoutResult.status !== 0) {
        return { kind: 'checkout-failed', stderr: checkoutResult.stderr };
    }

    return { kind: 'adopted', branch };
}

export function generateSyncId(): string {
    const originResult = spawnSync('git', ['remote', 'get-url', 'origin'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (originResult.status === 0 && originResult.stdout) {
        const url = originResult.stdout.trim();
        // Extract "owner/repo" from HTTPS or SSH remote URLs
        const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (match?.[1]) return match[1].replace('/', '-');
    }

    const toplevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });

    if (toplevelResult.status === 0 && toplevelResult.stdout) {
        return basename(toplevelResult.stdout.trim()) || 'unknown';
    }

    return basename(process.cwd()) || 'unknown';
}
