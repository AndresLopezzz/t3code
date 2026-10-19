import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext } from "react";
import { agentSessionScan } from "../state/agentSessions";
import { environmentAtomList, environmentIdsKey } from "../state/environmentAtomList";
import { formatEnvironmentQueryError } from "../state/query";

const scanAtom = (environmentId: EnvironmentId, workspaceRoot?: string) =>
  agentSessionScan({ environmentId, input: workspaceRoot === undefined ? {} : { workspaceRoot } });
const projectScansAtom = Atom.family((workspaceRoot: string | undefined) =>
  environmentAtomList("web-project-scans", (environmentId) =>
    scanAtom(environmentId, workspaceRoot),
  ),
);
export function useProjectScans(environmentIds: readonly EnvironmentId[], workspaceRoot?: string) {
  const registry = useContext(RegistryContext);
  const results = useAtomValue(projectScansAtom(workspaceRoot)(environmentIdsKey(environmentIds)));
  return environmentIds.map((environmentId, index) => {
    const result = results[index]!;
    return {
      environmentId,
      data: Option.getOrNull(AsyncResult.value(result)),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
      isPending: result.waiting || result._tag === "Initial",
      refresh: () => registry.refresh(scanAtom(environmentId, workspaceRoot)),
    };
  });
}
