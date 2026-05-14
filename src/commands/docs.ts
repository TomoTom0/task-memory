import usageDocs from '../../docs/usage/index.md?raw';
import agentClaudeMdDocs from '../../docs/usage/agent-claude-md.md?raw';
import agentGuideDocs from '../../docs/usage/agent-guide.md?raw';

const docMap: Record<string, string> = {
    'usage': usageDocs,
    'agent-claude-md': agentClaudeMdDocs,
    'agent-guide': agentGuideDocs,
};

export function docsCommand(args: string[]): void {
    const page = args[0] || 'usage';

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: tm docs [page]

Pages:
  usage (default)       User guide
  agent-claude-md       CLAUDE.md template for AI agents
  agent-guide           Agent workflow guide
`);
        return;
    }

    const content = docMap[page];
    if (!content) {
        console.error(`Error: Unknown docs page '${page}'.`);
        console.error(`Available pages: ${Object.keys(docMap).join(', ')}`);
        process.exit(1);
    }

    console.log(content);
}
