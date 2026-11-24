import { join, basename, dirname, resolve, sep } from 'path';
import { homedir, tmpdir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, mkdtempSync, rmSync, cpSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import envPaths from 'env-paths';
import type { TaskStore, SyncConfig } from './types';

export interface SyncGlobalConfig {
    defaultAuto: boolean;
}

// 同期ディレクトリのクロスプラットフォーム対応（TASK-8）。
// env-pathsはOSごとの標準的なアプリケーションデータ置き場を返す:
//   Linux:   $XDG_DATA_HOME/task-memory または ~/.local/share/task-memory
//   macOS:   ~/Library/Application Support/task-memory
//   Windows: %LOCALAPPDATA%\task-memory\Data
// suffixを空にしないとディレクトリ名が task-memory-nodejs になるため明示的に無効化する
// （設計: docs/dev/feature/cross-platform-sync-dir.md）。旧パス（getLegacySyncDir）に
// あるデータは migrateLegacySyncDir が新パスへ自動移行する。
const SYNC_APP_NAME = 'task-memory';

export function getSyncDir(): string {
    return envPaths(SYNC_APP_NAME, { suffix: '' }).data;
}

// v0.6.0以前の同期ディレクトリ。.local はLinux慣習だが全OSで使っていた。
// 移行の入力側としてのみ参照される
export function getLegacySyncDir(): string {
    return join(homedir(), '.local', 'task-memory');
}

// --- 旧同期ディレクトリからの移行 ---

// ディレクトリ内にtmが管理するデータ（git repo・projectデータ・グローバル設定）が
// あるか。いずれも無いdirは「tmのデータ」とみなさず、移行・衝突判定の対象にしない
export function hasSyncData(dir: string): boolean {
    return existsSync(join(dir, '.git')) || existsSync(join(dir, 'projects')) || existsSync(join(dir, 'config.json'));
}

function isDirectoryPath(p: string): boolean {
    try {
        return statSync(p).isDirectory();
    } catch {
        return false;
    }
}

// dirの状態。ファイル等の「dirとして読めないpath」は非空扱い（対象を誤って消去・
// 上書きしない側に倒す）
export type DirectoryState = 'absent' | 'empty' | 'non-empty';

export function getDirectoryState(dir: string): DirectoryState {
    if (!existsSync(dir)) return 'absent';
    try {
        return readdirSync(dir).length === 0 ? 'empty' : 'non-empty';
    } catch {
        return 'non-empty';
    }
}

// migrateLegacySyncDirの判定入力。OS判定（パスの決定）はenv-paths側に委譲して
// あるため、ここはパス文字列の組合せだけで決まる純粋な状態
export interface LegacySyncDirPresence {
    legacyExists: boolean;
    legacyHasData: boolean;
    targetState: DirectoryState;
}

export type LegacySyncDirMigrationAction =
    | { action: 'none'; reason: 'legacy-absent' | 'legacy-no-data' }
    | { action: 'move'; clearEmptyTarget: boolean }
    | { action: 'conflict' };

// 旧dirと新dirの状態から移行のアクションを決める純粋関数（前提: 両パスは異なる。
// 同一パスの判定は呼び出し側が行う）:
//   - 旧dirが無い: 何もしない（新規ユーザー・移行済み）
//   - 新dirが無い/空dir: 旧dirを新dirへmove（空dirはtmのデータではありえないため除去）
//   - 新dirが非存在以外で旧dirにtmのデータが無い: 何もしない（旧dirは無視、新dir優勢）
//   - 両dirにデータがある: 上書き事故を防ぐため移行せず衝突として警告
export function decideLegacySyncDirMigration(presence: LegacySyncDirPresence): LegacySyncDirMigrationAction {
    if (!presence.legacyExists) return { action: 'none', reason: 'legacy-absent' };
    if (presence.targetState === 'absent') return { action: 'move', clearEmptyTarget: false };
    if (presence.targetState === 'empty') return { action: 'move', clearEmptyTarget: true };
    if (!presence.legacyHasData) return { action: 'none', reason: 'legacy-no-data' };
    return { action: 'conflict' };
}

export type LegacySyncDirMigrationResult =
    | { kind: 'not-needed'; reason: 'legacy-absent' | 'same-path' | 'legacy-no-data' }
    | { kind: 'migrated'; from: string; to: string }
    | { kind: 'conflict'; from: string; to: string }
    | { kind: 'failed'; from: string; to: string; error: string };

// 移行記録のmarker file（新dir直下）。gitの追跡対象からは外す
const MIGRATION_MARKER_FILENAME = '.migrated-from';

export interface SyncDirMigrationRecord {
    from: string;
    to: string;
    migratedAt: string;
}

export function getMigrationMarkerPath(): string {
    return join(getSyncDir(), MIGRATION_MARKER_FILENAME);
}

function isErrnoCode(e: unknown, code: string): boolean {
    return typeof e === 'object' && e !== null && 'code' in e && e.code === code;
}

// renameを試み、cross-device (EXDEV) の場合のみcopy+削除へfallbackする。
// それ以外の失敗（権限等）は移行失敗として呼び出し側へ伝える
export function moveDirectory(from: string, to: string): void {
    try {
        renameSync(from, to);
    } catch (e: unknown) {
        if (!isErrnoCode(e, 'EXDEV')) throw e;
        copyDirThenRemove(from, to);
    }
}

// EXDEV fallbackの実体（XDG_DATA_HOME等で別ファイルシステムを指した場合の経路）。
// copyが完了してから旧dirを削除する
export function copyDirThenRemove(from: string, to: string): void {
    // verbatimSymlinks: symlinkのリンクテキストをそのまま保持する。既定の挙動では
    // 相対symlinkのターゲットが旧dir内の絶対パスへ解決されて書き換わるため、旧dirを
    // 削除した時点でリンクが切れる（PR #49レビュー指摘）
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
}

function writeMigrationMarker(record: SyncDirMigrationRecord): void {
    try {
        // markerをgit repoの追跡対象外にする（git statusへの雑音防止。.gitが無い
        // 移行結果〔非git dirの旧データ〕ではexcludeの書き先が無いためスキップ）
        if (existsSync(join(getSyncDir(), '.git'))) {
            ensureGitExcludePattern(MIGRATION_MARKER_FILENAME);
        }
        writeFileSync(getMigrationMarkerPath(), JSON.stringify(record, null, 2) + '\n', 'utf-8');
    } catch (e: unknown) {
        // markerは証跡であり、書けなくても移行自体は成立している
        console.error(`Warning: could not write migration marker file: ${e}`);
    }
}

// 旧同期ディレクトリ（~/.local/task-memory）から現行の同期ディレクトリ（env-pathsの
// data path）への移行を冪等に実行する。tm sync / tm git コマンドの入口と自動同期
// （tryAutoSync）の入口で呼ばれる。移行済み（旧dirが無い）なら何もしないため、
// 何度呼んも安全（二重移行が起きない）。旧dir・新dirの両方にデータがある場合は
// 既存の新パスデータの上書き事故を防ぐため移行せず、手動解決を促す警告のみ出す
// 相対パスで書かれたremote URLはrepoの場所を基準に解決されるため、同期
// ディレクトリを移動すると接続先が変わってしまう（PR #52レビュー指摘）。
// scheme付きURL・絶対パス・scp形式（host:path）は場所に依存しないので対象外
export function isRelativeLocalPathUrl(url: string): boolean {
    if (url.length === 0) return false;
    if (url.startsWith('/') || url.startsWith('~')) return false;
    // Windows絶対パス (C:\... / C:/...)
    if (/^[a-zA-Z]:[\\/]/.test(url)) return false;
    if (url.includes('://')) return false;
    // scp形式や host:path は最初の '/' より前に ':' がある
    const colon = url.indexOf(':');
    const slash = url.indexOf('/');
    if (colon !== -1 && (slash === -1 || colon < slash)) return false;
    return true;
}

function gitIn(dir: string, args: string[]): { status: number; stdout: string } {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: 'pipe' });
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

// 移行でrepoの場所が変わるため、相対パスで設定されたremote URLを旧dir基準の
// 絶対パスへ書き換えて接続先を保持する。書き換えに失敗しても移行自体は成立
// しているため、markerと同じく警告に留める
function preserveRelativeRemoteUrls(from: string, to: string): void {
    if (!existsSync(join(to, '.git'))) return;
    const remotes = gitIn(to, ['remote']);
    if (remotes.status !== 0) return;
    for (const remote of remotes.stdout.split('\n').map(s => s.trim()).filter(s => s.length > 0)) {
        // pushurlは明示設定されている場合のみ対象にする（get-url --pushは
        // 未設定時にfetch URLを返すため、configを直接読んで区別する）。
        // expandedはinsteadOf展開後の実効URL。rawと異なる場合はinsteadOfの
        // エイリアスであり場所に依存しないため、相対パスに見えても対象外
        // （PR #53レビュー指摘）
        const entries: { push: boolean; url: string; expanded: string | null }[] = [];
        const fetch = gitIn(to, ['config', '--get', `remote.${remote}.url`]);
        if (fetch.status === 0) {
            const expanded = gitIn(to, ['remote', 'get-url', remote]);
            entries.push({ push: false, url: fetch.stdout.trim(), expanded: expanded.status === 0 ? expanded.stdout.trim() : null });
        }
        const pushUrl = gitIn(to, ['config', '--get', `remote.${remote}.pushurl`]);
        if (pushUrl.status === 0) {
            const expanded = gitIn(to, ['remote', 'get-url', '--push', remote]);
            entries.push({ push: true, url: pushUrl.stdout.trim(), expanded: expanded.status === 0 ? expanded.stdout.trim() : null });
        }
        for (const entry of entries) {
            if (!isRelativeLocalPathUrl(entry.url)) continue;
            if (entry.expanded === null || entry.expanded !== entry.url) continue;
            const absolute = resolve(from, entry.url);
            const setArgs = entry.push
                ? ['remote', 'set-url', '--push', remote, absolute]
                : ['remote', 'set-url', remote, absolute];
            if (gitIn(to, setArgs).status !== 0) {
                console.error(`Warning: could not preserve relative remote URL for "${remote}": ${entry.url}`);
            }
        }
    }
}

export function migrateLegacySyncDir(): LegacySyncDirMigrationResult {
    const from = getLegacySyncDir();
    const to = getSyncDir();
    if (resolve(from) === resolve(to)) {
        return { kind: 'not-needed', reason: 'same-path' };
    }
    const decision = decideLegacySyncDirMigration({
        legacyExists: isDirectoryPath(from),
        legacyHasData: hasSyncData(from),
        targetState: getDirectoryState(to),
    });
    if (decision.action === 'none') {
        return { kind: 'not-needed', reason: decision.reason };
    }
    if (decision.action === 'conflict') {
        console.error('Warning: both the legacy sync directory and the current sync directory exist.');
        console.error(`  legacy:  ${from}`);
        console.error(`  current: ${to}`);
        console.error('Skipped migration to avoid overwriting either one. If the legacy data is the one to keep,');
        console.error(`remove or rename the current directory, then run a tm sync command again.`);
        return { kind: 'conflict', from, to };
    }
    try {
        if (decision.clearEmptyTarget) {
            rmSync(to, { recursive: true, force: true });
        }
        mkdirSync(dirname(to), { recursive: true });
        moveDirectory(from, to);
    } catch (e: unknown) {
        console.error(`Warning: failed to migrate sync directory from ${from} to ${to}: ${e}`);
        return { kind: 'failed', from, to, error: String(e) };
    }
    preserveRelativeRemoteUrls(from, to);
    writeMigrationMarker({ from, to, migratedAt: new Date().toISOString() });
    console.log(`Migrated sync data directory: ${from} -> ${to}`);
    return { kind: 'migrated', from, to };
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

    // 旧パスにデータがあるまま新パスが未初期化だと自動同期が黙って止まるため、
    // 移行を先に試みる（TASK-8）
    migrateLegacySyncDir();

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

// sync repoの.git/info/excludeへpattern行を追加する（backup file・移行marker等、
// ローカル専用fileのgit status雑音防止。既に含まれていれば何もしない）
function ensureGitExcludePattern(pattern: string): void {
    const excludePath = join(getSyncDir(), '.git', 'info', 'exclude');
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    if (!current.split('\n').includes(pattern)) {
        mkdirSync(dirname(excludePath), { recursive: true });
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
        ensureGitExcludePattern('*.bak-*');
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
