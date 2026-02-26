import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import type { Review, ReviewStore } from './types';
import { findGitPath } from './store';

export function getReviewDbPath(): string {
    if (process.env.REVIEW_MEMORY_PATH) {
        return process.env.REVIEW_MEMORY_PATH;
    }

    const gitPath = findGitPath(process.cwd());
    if (gitPath) {
        let isGitDir = false;
        try {
            isGitDir = statSync(gitPath).isDirectory();
        } catch { }

        if (isGitDir) {
            return join(gitPath, 'review-memory.json');
        }
        // .gitがファイル（worktree）の場合、プロジェクトルートに保存
        return join(dirname(gitPath), 'review-memory.json');
    }

    return join(homedir(), '.review-memory.json');
}

const DB_PATH = getReviewDbPath();

export function loadReviews(): Review[] {
    if (!existsSync(DB_PATH)) {
        return [];
    }
    try {
        const data = readFileSync(DB_PATH, 'utf-8');
        const store: ReviewStore = JSON.parse(data);

        if (Array.isArray(store)) {
            return store as Review[];
        }
        return (store as any).reviews || [];
    } catch (e) {
        console.error(`Error loading reviews from ${DB_PATH}:`, e);
        return [];
    }
}

export function saveReviews(reviews: Review[]): void {
    try {
        writeFileSync(DB_PATH, JSON.stringify(reviews, null, 2), 'utf-8');
    } catch (e) {
        console.error(`Error saving reviews to ${DB_PATH}:`, e);
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
