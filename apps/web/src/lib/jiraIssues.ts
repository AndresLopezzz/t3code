import {
  findAndReplaceText,
  type MarkdownNode,
  type TextMatch,
} from "~/vendor/mdast-find-and-replace";

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
  return (tree: MarkdownNode) => {
    findAndReplaceText(
      tree,
      JIRA_KEY_PATTERN,
      (matched: string, _match: TextMatch) =>
        isJiraKey(matched)
          ? {
              type: "link",
              url: jiraIssueUrl(matched),
              children: [{ type: "text", value: matched }],
            }
          : false,
      IGNORED_TYPES,
    );
  };
}
