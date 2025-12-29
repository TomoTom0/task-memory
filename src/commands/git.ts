import { runGitCommand, isSyncInitialized, getSyncDir } from '../syncStore';

export function gitCommand(args: string[]): void {
    if (!isSyncInitialized()) {
        console.error('Sync repository not initialized. Run "tm sync init" first.');
        process.exit(1);
    }

    if (args.length === 0) {
        console.log(`Git repository at: ${getSyncDir()}`);
        console.log('Usage: tm git <git-command> [args]');
        console.log('');
        console.log('Examples:');
        console.log('  tm git status');
        console.log('  tm git remote add origin git@github.com:user/task-memory.git');
        console.log('  tm git push');
        console.log('  tm git pull');
        return;
    }

    const exitCode = runGitCommand(args);
    process.exit(exitCode);
}
