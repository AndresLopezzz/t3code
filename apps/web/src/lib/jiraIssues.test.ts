import { unified } from "unified";
import remarkParse from "remark-parse";
import { describe, expect, it } from "vite-plus/test";

import { findJiraIssueKey, jiraKeyFromUrl, remarkJiraAutolinks } from "./jiraIssues";

describe("findJiraIssueKey", () => {
  it.each([
    { sources: ["feat/dep-431-filtro", "Mi digitación"], expected: "DEP-431" },
    { sources: [null, "SUV2-2271 visor"], expected: "SUV2-2271" },
    { sources: ["main", "Arreglar UTF-8 y SHA-256"], expected: null },
    { sources: ["fix/ISO-8601", "DEP-12 fechas"], expected: "DEP-12" },
  ])("$sources → $expected", ({ sources, expected }) => {
    expect(findJiraIssueKey(...sources)).toBe(expected);
  });
});

describe("jiraKeyFromUrl", () => {
  it.each([
    { url: "https://naowee.atlassian.net/browse/DEP-431?focus=1", expected: "DEP-431" },
    { url: "https://naowee.atlassian.net/jira/software/projects/DEP", expected: null },
    { url: "https://github.com/x/browse/DEP-431", expected: null },
  ])("$url → $expected", ({ url, expected }) => {
    expect(jiraKeyFromUrl(url)).toBe(expected);
  });
});

it("links Jira keys in prose while preserving code, authored links and non-Jira identifiers", () => {
  const processor = unified().use(remarkParse).use(remarkJiraAutolinks);
  const tree = processor.runSync(
    processor.parse("DEP-431 and SUV2-2271 UTF-8 `DEP-432` [DEP-433](https://example.com)"),
  );
  expect(tree).toMatchObject({
    children: [
      {
        children: [
          { type: "link", url: "https://naowee.atlassian.net/browse/DEP-431" },
          { type: "text", value: " and " },
          { type: "link", url: "https://naowee.atlassian.net/browse/SUV2-2271" },
          { type: "text", value: " UTF-8 " },
          { type: "inlineCode", value: "DEP-432" },
          { type: "text", value: " " },
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", value: "DEP-433" }],
          },
        ],
      },
    ],
  });
});
