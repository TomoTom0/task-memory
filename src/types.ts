export type TaskStatus = 'todo' | 'wip' | 'done' | 'pending' | 'long' | 'closed';

export interface TaskBody {
    text: string;
    created_at: string;
}

export interface TaskFiles {
    read: string[];
    edit: string[];
}

export interface Task {
    id: string;
    status: TaskStatus;
    priority?: string;
    version?: string;
    goal?: string;
    order?: string | null;
    summary: string;
    bodies: TaskBody[];
    files: TaskFiles;
    created_at: string;
    updated_at: string;
}

export interface SyncConfig {
    id: string;           // プロジェクト識別子（同期リポジトリ内でのファイル名）
    enabled: boolean;     // 同期が有効かどうか
    auto: boolean;        // 自動同期（タスク変更時に自動でpush）
}

export interface TaskStore {
    sync?: SyncConfig;
    tasks: Task[];
}

export type ReviewStatus = 'todo' | 'wip' | 'checking' | 'closed' | 'done' | 'pending';

export interface Review {
    id: string;
    title: string;
    bodies: TaskBody[]; // History of bodies
    status: ReviewStatus;
    created_at: string;
    updated_at: string;
    related_task_ids?: string[];
}

export interface ReviewStore {
    reviews: Review[];
}
