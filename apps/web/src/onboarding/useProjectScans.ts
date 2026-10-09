import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext, useMemo } from "react";

import { agentSessionScan } from "../state/agentSessions";
import { formatEnvironmentQueryError } from "../state/query";

/** Subscribe to each selected computer without coupling their failures or refreshes. */
export function useProjectScans(environmentIds: readonly EnvironmentId[], workspaceRoot?: string) {
  const registry = useContext(RegistryContext);
  const scansAtom = useMemo(
    () =>
      Atom.make((get) =>
        environmentIds.map((environmentId) => {
          const atom = agentSessionScan({
            environmentId,
            input: workspaceRoot === undefined ? {} : { workspaceRoot },
          });
          const result = get(atom);
          return {
            environmentId,
            data: Option.getOrNull(AsyncResult.value(result)),
            error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
            isPending: result.waiting || result._tag === "Initial",
            refresh: () => registry.refresh(atom),
          };
        }),
      ),
    [environmentIds, registry, workspaceRoot],
  );
  return useAtomValue(scansAtom);
}
