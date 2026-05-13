import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import type { Review, ReviewStore } from './types';
import { findGitPath } from './store';

export function getReviewDbPath(): string {
    const gitPath = findGitPath(process.cwd());
    if (gitPath) {
        try {
            if (statSync(gitPath).isDirectory()) {
                return join(gitPath, 'review-memory.json');
            }
        } catch { }
        // .gitがファイル（worktree）の場合、プロジェクトルートに保存
        return join(dirname(gitPath), 'review-memory.json');
    }

    return join(homedir(), '.review-memory.json');
}

export function loadReviews(): Review[] {
    const dbPath = getReviewDbPath();
    if (!existsSync(dbPath)) {
        return [];
    }
    try {
        const data = readFileSync(dbPath, 'utf-8');
        const store: ReviewStore = JSON.parse(data);

        if (Array.isArray(store)) {
            return store as Review[];
        }
        return (store as any).reviews || [];
    } catch (e) {
        console.error(`Error loading reviews from ${dbPath}:`, e);
        return [];
    }
}

export function saveReviews(reviews: Review[]): void {
    const dbPath = getReviewDbPath();
    try {
        writeFileSync(dbPath, JSON.stringify(reviews, null, 2), 'utf-8');
    } catch (e) {
        console.error(`Error saving reviews to ${dbPath}:`, e);
    }
}

export function getReviewById(reviews: Review[], idOrIndex: string | number): Review | undefined {
    if (typeof idOrIndex === 'number') {
        const targetId = `REVIEW-${idOrIndex}`;
        return reviews.find(r => r.id === targetId);
    }

    const idStr = idOrIndex.toString();
    if (idStr.match(/^\d+$/)) {
        return reviews.find(r => r.id === `REVIEW-${idStr}`);
    }

    return reviews.find(r => r.id === idStr);
}

export function getNextReviewId(reviews: Review[]): string {
    let max = 0;
    for (const review of reviews) {
        const match = review.id.match(/^REVIEW-(\d+)$/);
        if (match) {
            const num = parseInt(match[1]!, 10);
            if (num > max) max = num;
        }
    }
    return `REVIEW-${max + 1}`;
}
