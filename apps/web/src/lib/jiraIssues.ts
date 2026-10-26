import type { Root, RootContent, PhrasingContent } from "mdast";

const JIRA_SITE_URL = "https://naowee.atlassian.net";
const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,5}\b/gu;
// Standards and encodings that look like issue keys.
const NOT_JIRA_PROJECTS = new Set(["UTF", "ISO", "SHA", "RFC", "CVE", "ES", "HTTP", "TLS", "WCAG"]);
const IGNORED_TYPES = new Set(["link", "linkReference"]);

function isJiraKey(key: string): boolean {
  return !NOT_JIRA_PROJECTS.has(key.slice(0, key.indexOf("-")));
}

export function jiraIssueUrl(key: string): string {
  return `${JIRA_SITE_URL}/browse/${key}`;
}

/** The issue key of a `<site>/browse/KEY` link, or null. */
export function jiraKeyFromUrl(url: string): string | null {
  const prefix = `${JIRA_SITE_URL}/browse/`;
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length).split(/[/?#]/u)[0] ?? "";
  return findJiraIssueKey(key) === key ? key : null;
}

/** First issue key in a branch name or title (`feat/DEP-431-x`, `DEP-431 fix`). */
export function findJiraIssueKey(...sources: ReadonlyArray<string | null | undefined>) {
  for (const source of sources) {
    for (const match of source?.toUpperCase().matchAll(JIRA_KEY_PATTERN) ?? []) {
      if (isJiraKey(match[0])) return match[0];
    }
  }
  return null;
}

/** Turns issue keys in chat prose into links; code and authored links are left alone. */
export function remarkJiraAutolinks() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent): void => {
      if (
        node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "emphasis" ||
        node.type === "strong" ||
        node.type === "delete" ||
        node.type === "tableCell"
      ) {
        node.children = node.children.flatMap((child): PhrasingContent[] => {
          if (child.type !== "text") {
            visit(child);
            return [child];
          }
          const parts: PhrasingContent[] = [];
          let offset = 0;
          for (const match of child.value.matchAll(JIRA_KEY_PATTERN)) {
            if (!isJiraKey(match[0])) continue;
            if (match.index > offset)
              parts.push({ type: "text", value: child.value.slice(offset, match.index) });
            parts.push({
              type: "link",
              url: jiraIssueUrl(match[0]),
              children: [{ type: "text", value: match[0] }],
            });
            offset = match.index + match[0].length;
          }
          if (offset < child.value.length)
            parts.push({ type: "text", value: child.value.slice(offset) });
          return parts;
        });
      } else if (!IGNORED_TYPES.has(node.type) && "children" in node) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
}
