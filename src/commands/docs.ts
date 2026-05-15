import usageDocs from '../../docs/usage/index.md';
import agentClaudeMdDocs from '../../docs/usage/agent-claude-md.md';
import agentGuideDocs from '../../docs/usage/agent-guide.md';

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

    if (!Object.hasOwn(docMap, page)) {
        console.error(`Error: Unknown docs page '${page}'.`);
        console.error(`Available pages: ${Object.keys(docMap).join(', ')}`);
        process.exit(1);
    }

    const content = docMap[page];

    console.log(content);
}
