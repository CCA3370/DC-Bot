export interface MentionLookup {
  users?: ReadonlyMap<string, string>;
  channels?: ReadonlyMap<string, string>;
  roles?: ReadonlyMap<string, string>;
}

export function markdownToPlainText(input: string, lookup: MentionLookup = {}) {
  return input
    .replace(/```([\s\S]*?)```/g, (_, content: string) => content.trim())
    .replace(/(^|\n)[ \t]{0,3}(?:>[ \t]*)+/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\|\|([^|]+)\|\|/g, "$1")
    .replace(/(^|\n)-\s+/g, "$1• ")
    .replace(/<@!?(\d+)>/g, (_, id: string) => `@${lookup.users?.get(id) ?? id}`)
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${lookup.roles?.get(id) ?? id}`)
    .replace(/<#(\d+)>/g, (_, id: string) => `#${lookup.channels?.get(id) ?? id}`)
    .replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ":$1:")
    .replace(/\r\n/g, "\n")
    .trim();
}
