import { getDbPath } from '../store';

export function envCommand(): void {
    console.log(getDbPath());
}
