import { getDbPath } from '../store';

export function envCommand(args: string[] = []): void {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm env

Description:
  Show the current task data file path.
`);
        return;
    }

    console.log(getDbPath());
}
