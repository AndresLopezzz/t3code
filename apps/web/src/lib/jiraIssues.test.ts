import { describe, expect, it } from "vite-plus/test";

import { findJiraIssueKey, jiraKeyFromUrl } from "./jiraIssues";

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
