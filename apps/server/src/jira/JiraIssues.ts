import { JiraIssueError, type JiraBoard, type JiraIssue } from "@t3tools/contracts";
import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

/** `<secretsDir>/jira.json`, written by hand: the API token never passes through the app UI. */
const JiraCredentials = Schema.Struct({
  siteUrl: Schema.String,
  email: Schema.String,
  apiToken: Schema.String,
});

const MAX_COMMENTS = 30;

type Json = Record<string, unknown> | undefined;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const name = (value: unknown): string | null =>
  text(record(value)?.displayName) ?? text(record(value)?.name);

function toJiraIssue(siteUrl: string, key: string, body: unknown): JiraIssue {
  const fields = record(record(body)?.fields);
  const rendered = record(record(body)?.renderedFields);
  const status = record(fields?.status);
  const rawComments = record(fields?.comment)?.comments;
  const renderedComments = record(rendered?.comment)?.comments;
  const comments = Array.isArray(rawComments) ? rawComments : [];
  return {
    key,
    url: `${siteUrl}/browse/${key}`,
    summary: text(fields?.summary) ?? key,
    status: text(status?.name) ?? "",
    statusCategory: text(record(status?.statusCategory)?.key) ?? "",
    issueType: name(fields?.issuetype) ?? "",
    priority: name(fields?.priority),
    assignee: name(fields?.assignee),
    reporter: name(fields?.reporter),
    created: text(fields?.created) ?? "",
    updated: text(fields?.updated) ?? "",
    dueDate: text(fields?.duedate),
    labels: list(fields?.labels).flatMap((label) => (typeof label === "string" ? [label] : [])),
    components: list(fields?.components).flatMap((component) => name(component) ?? []),
    // Jira Cloud keeps the sprint in customfield_10020; the last entry is the current one.
    sprint: name(list(fields?.customfield_10020).at(-1)),
    parent: text(record(fields?.parent)?.key)
      ? {
          key: text(record(fields?.parent)?.key) ?? "",
          summary: text(record(record(record(fields?.parent)?.fields))?.summary) ?? "",
        }
      : null,
    descriptionHtml: text(rendered?.description) || null,
    comments: comments.slice(-MAX_COMMENTS).map((comment, index) => {
      const renderedBody = Array.isArray(renderedComments)
        ? record(
            renderedComments[comments.length - Math.min(comments.length, MAX_COMMENTS) + index],
          )?.body
        : undefined;
      return {
        author: name(record(comment)?.author),
        created: text(record(comment)?.created) ?? "",
        bodyHtml: text(renderedBody) ?? "",
      };
    }),
    transitions: list(record(body)?.transitions).flatMap((transition) => {
      const id = text(record(transition)?.id);
      const transitionName = text(record(transition)?.name);
      return id && transitionName
        ? [{ id, name: transitionName, toStatus: name(record(transition)?.to) ?? transitionName }]
        : [];
    }),
  };
}

const jiraClient = Effect.fn("jiraClient")(function* (secretsDir: string, key: string) {
  const fail = (reason: string) => new JiraIssueError({ key, reason });
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const credentials = yield* fileSystem.readFileString(path.join(secretsDir, "jira.json")).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(JiraCredentials))),
    Effect.mapError(() => fail(`missing or invalid ${path.join(secretsDir, "jira.json")}`)),
  );
  const siteUrl = credentials.siteUrl.replace(/\/+$/u, "");
  const client = yield* HttpClient.HttpClient;
  // Pasted tokens often carry stray whitespace or a newline.
  const auth = Base64.encode(
    `${credentials.email.trim()}:${credentials.apiToken.replace(/\s/gu, "")}`,
  );
  const execute = (request: HttpClientRequest.HttpClientRequest) =>
    client
      .execute(
        request.pipe(
          HttpClientRequest.setHeaders({
            authorization: `Basic ${auth}`,
            accept: "application/json",
          }),
        ),
      )
      .pipe(
        Effect.mapError((error) => fail(error.message)),
        Effect.flatMap((response) => {
          if (response.status === 404) return Effect.fail(fail("issue not found or no access"));
          if (response.status === 401 || response.status === 403) {
            return Effect.fail(fail("Jira rejected the credentials"));
          }
          return HttpClientResponse.filterStatusOk(response).pipe(
            Effect.catch(() =>
              response.json.pipe(
                Effect.orElseSucceed(() => undefined),
                Effect.flatMap((body) =>
                  Effect.fail(fail(jiraErrorMessage(body) ?? `Jira answered ${response.status}`)),
                ),
              ),
            ),
          );
        }),
      );
  return { siteUrl, execute, fail };
});

// Jira explains rejected transitions (e.g. a required field) in errorMessages/errors.
function jiraErrorMessage(body: unknown): string | null {
  const messages = record(body)?.errorMessages;
  const fieldErrors = Object.values(record(record(body)?.errors) ?? {});
  const all = [...(Array.isArray(messages) ? messages : []), ...fieldErrors].filter(
    (message): message is string => typeof message === "string",
  );
  return all.length > 0 ? all.join(" ") : null;
}

const fetchIssue = Effect.fn("fetchJiraIssue")(function* (secretsDir: string, key: string) {
  const { siteUrl, execute, fail } = yield* jiraClient(secretsDir, key);
  const response = yield* execute(
    HttpClientRequest.get(`${siteUrl}/rest/api/3/issue/${key}`, {
      urlParams: {
        fields:
          "summary,status,issuetype,priority,assignee,reporter,created,updated,duedate,labels,components,parent,customfield_10020,description,comment",
        expand: "renderedFields,transitions",
      },
    }),
  );
  const body = yield* response.json.pipe(Effect.mapError((error) => fail(error.message)));
  return toJiraIssue(siteUrl, key, body);
});

const transitionIssue = Effect.fn("transitionJiraIssue")(function* (
  secretsDir: string,
  key: string,
  transitionId: string,
) {
  const { siteUrl, execute } = yield* jiraClient(secretsDir, key);
  yield* execute(
    HttpClientRequest.post(`${siteUrl}/rest/api/3/issue/${key}/transitions`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ transition: { id: transitionId } }),
    ),
  );
});

// A board drop names a column, not a transition: take the first one Jira offers into it.
const moveIssue = Effect.fn("moveJiraIssue")(function* (
  secretsDir: string,
  key: string,
  toStatus: string,
) {
  const { siteUrl, execute, fail } = yield* jiraClient(secretsDir, key);
  const response = yield* execute(
    HttpClientRequest.get(`${siteUrl}/rest/api/3/issue/${key}/transitions`),
  );
  const body = yield* response.json.pipe(Effect.mapError((error) => fail(error.message)));
  const target = toStatus.toLowerCase();
  const id = list(record(body)?.transitions)
    .map((transition) => record(transition))
    .find((transition) => name(transition?.to)?.toLowerCase() === target)?.id;
  if (typeof id !== "string") {
    return yield* fail(`Jira offers no way to move it to ${toStatus}`);
  }
  yield* transitionIssue(secretsDir, key, id);
});

const fetchBoard = Effect.fn("fetchJiraBoard")(function* (secretsDir: string) {
  const { siteUrl, execute, fail } = yield* jiraClient(secretsDir, "board");
  const response = yield* execute(
    HttpClientRequest.post(`${siteUrl}/rest/api/3/search/jql`).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        jql: "assignee = currentUser() AND sprint in openSprints() ORDER BY rank ASC",
        fields: ["summary", "status", "issuetype", "priority"],
        maxResults: 100,
      }),
    ),
  );
  const body = yield* response.json.pipe(Effect.mapError((error) => fail(error.message)));
  return {
    issues: list(record(body)?.issues).flatMap((issue) => {
      const key = text(record(issue)?.key);
      const fields = record(record(issue)?.fields);
      const status = record(fields?.status);
      return key
        ? [
            {
              key,
              summary: text(fields?.summary) ?? key,
              status: text(status?.name) ?? "",
              statusCategory: text(record(status?.statusCategory)?.key) ?? "",
              issueType: name(fields?.issuetype) ?? "",
              priority: name(fields?.priority),
            },
          ]
        : [];
    }),
  } satisfies JiraBoard;
});

const withTimeout =
  (key: string) =>
  <A, R>(effect: Effect.Effect<A, JiraIssueError, R>) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(new JiraIssueError({ key, reason: "Jira took too long" })),
      }),
    );

export const transitionJiraIssue = (secretsDir: string, key: string, transitionId: string) =>
  transitionIssue(secretsDir, key, transitionId).pipe(withTimeout(key));

export const moveJiraIssue = (secretsDir: string, key: string, toStatus: string) =>
  moveIssue(secretsDir, key, toStatus).pipe(withTimeout(key));

export const fetchJiraBoard = (secretsDir: string) =>
  fetchBoard(secretsDir).pipe(withTimeout("board"));

export const fetchJiraIssue = (secretsDir: string, key: string) =>
  fetchIssue(secretsDir, key).pipe(withTimeout(key));
