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
    summary: string;
    bodies: TaskBody[];
    files: TaskFiles;
    created_at: string;
    updated_at: string;
}

export interface TaskStore {
    tasks: Task[];
}

export type ReviewStatus = 'todo' | 'wip' | 'checking' | 'closed' | 'done' | 'pending';

export interface Review {
    id: string;
    title: string;
    body: string; // Current body
    bodies: TaskBody[]; // History of bodies
    status: ReviewStatus;
    created_at: string;
    updated_at: string;
    related_task_ids?: string[];
}

export interface ReviewStore {
    reviews: Review[];
}
