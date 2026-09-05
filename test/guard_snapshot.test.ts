import { test, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { snapshotPath } from './global-setup';
import { getSandboxWorkDir } from './helpers';

// 実データ不変guardのsnapshot分岐の単体テスト（docs/design/test-isolation.md「ハッシュ定義」）。
// guard本体はglobalSetup/teardownとしてrun前後に一度だけ動くため、runをまたぐ受入手順
// （probe）とは別に、書き込みがsymlinkを辿って届く参照実体の検知・loop停止・absent遷移を
// ここで直接検証する

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(getSandboxWorkDir(), 'guard-snapshot-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

test('file: 不変なら等しく、内容変化で不一致になる', () => {
    const file = join(root, 'data.json');
    writeFileSync(file, 'a');
    const first = snapshotPath(file);
    expect(snapshotPath(file)).toEqual(first);
    writeFileSync(file, 'b');
    expect(snapshotPath(file)).not.toEqual(first);
});

test('absent -> present の遷移を不一致として検知する', () => {
    const file = join(root, 'new.json');
    expect(snapshotPath(file)).toEqual({ state: 'absent' });
    writeFileSync(file, 'x');
    expect(snapshotPath(file).state).toBe('present');
});

test('symlink対象: linkを辿った書き込み（参照実体の変更）を検知する', () => {
    const target = join(root, 'db.json');
    writeFileSync(target, 'initial');
    const link = join(root, 'guarded-link');
    symlinkSync(target, link);
    const before = snapshotPath(link);
    expect(before.state).toBe('present');
    // 本番コードと同じ経路（writeFileSyncはsymlinkを辿って参照実体へ書く）
    writeFileSync(link, 'modified');
    expect(snapshotPath(link)).not.toEqual(before);
});

test('symlink対象: 参照実体のchmodを検知する', () => {
    const target = join(root, 'db.json');
    writeFileSync(target, 'initial');
    const link = join(root, 'guarded-link');
    symlinkSync(target, link);
    const before = snapshotPath(link);
    chmodSync(target, 0o600);
    expect(snapshotPath(link)).not.toEqual(before);
});

test('symlink対象: retarget（同一内容でもリンクテキスト変化）を検知する', () => {
    const first = join(root, 'one.json');
    const second = join(root, 'two.json');
    writeFileSync(first, 'same');
    writeFileSync(second, 'same');
    const link = join(root, 'link');
    symlinkSync(first, link);
    const before = snapshotPath(link);
    unlinkSync(link);
    symlinkSync(second, link);
    expect(snapshotPath(link)).not.toEqual(before);
});

test('symlink対象: broken linkで実体が作られた（link越しの書き込み発生）ことを検知する', () => {
    const link = join(root, 'broken');
    symlinkSync(join(root, 'not-yet'), link);
    const before = snapshotPath(link);
    expect(before.state).toBe('present');
    // open(O_CREAT)はsymlinkを辿って参照実体を作る
    writeFileSync(link, 'created-through');
    expect(snapshotPath(link)).not.toEqual(before);
});

test('directory配下のsymlink file: 参照fileの内容変化を検知する', () => {
    const target = join(root, 'real.json');
    writeFileSync(target, 'initial');
    const guarded = join(root, 'guarded');
    mkdirSync(guarded);
    symlinkSync(target, join(guarded, 'link-to-file'));
    const before = snapshotPath(guarded);
    writeFileSync(target, 'modified');
    expect(snapshotPath(guarded)).not.toEqual(before);
});

test('directory配下のsymlink dir: 参照dirへの新規作成を検知する', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const guarded = join(root, 'guarded');
    mkdirSync(guarded);
    symlinkSync(outside, join(guarded, 'link-to-dir'));
    const before = snapshotPath(guarded);
    writeFileSync(join(outside, 'leak.json'), 'x');
    expect(snapshotPath(guarded)).not.toEqual(before);
});

test('symlink loop: 再帰が停止し、結果が決定的である', () => {
    const guarded = join(root, 'looped');
    mkdirSync(join(guarded, 'sub'), { recursive: true });
    symlinkSync(guarded, join(guarded, 'sub', 'up'));          // 親dirへのlink（dir-cycleで打ち切り）
    symlinkSync(join(guarded, 'self'), join(guarded, 'self')); // 自己link（解決不能 -> absent行）
    const first = snapshotPath(guarded);
    expect(first.state).toBe('present');
    expect(snapshotPath(guarded)).toEqual(first);
});

test('symlinkの参照実体がfifo: 内容を読まずに決定的なsnapshotを取る', () => {
    const fifo = join(root, 'pipe');
    const result = spawnSync('mkfifo', [fifo]);
    expect(result.status).toBe(0);
    const link = join(root, 'link-to-fifo');
    symlinkSync(fifo, link);
    const first = snapshotPath(link);
    expect(first.state).toBe('present');
    expect(snapshotPath(link)).toEqual(first);
});
