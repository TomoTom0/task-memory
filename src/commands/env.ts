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

    // env command doesn't accept any arguments
    if (args.length > 0) {
        console.error(`Error: env command doesn't accept arguments.`);
        return;
    }

    console.log(getDbPath());
}
