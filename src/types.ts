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
    summary: string;
    bodies: TaskBody[];
    files: TaskFiles;
    created_at: string;
    updated_at: string;
}

export interface TaskStore {
    tasks: Task[];
}
