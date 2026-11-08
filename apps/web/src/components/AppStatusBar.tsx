import type { DiscoveredLocalServer } from "@t3tools/contracts";
import {
  ExternalLinkIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  XIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";

import { ensureLocalApi } from "../localApi";
import { useDiscoveredPortsState } from "../portDiscoveryState";
import { usePrimaryEnvironmentId } from "../state/environments";
import { previewEnvironment } from "../state/preview";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { TerminalSessionsButton } from "./TerminalSessionsButton";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { FooterUsage } from "./usage/FooterUsage";

const STATUS_BAR_TRIGGER_CLASS =
  "flex h-full shrink-0 items-center gap-1.5 px-2 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground";

function PortRow({
  server,
  onKill,
}: {
  readonly server: DiscoveredLocalServer;
  readonly onKill: (server: DiscoveredLocalServer) => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
      <span className="w-12 shrink-0 font-medium tabular-nums">{server.port}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs">{server.processName ?? "unknown"}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {server.host}:{server.port}
          {server.pid !== null ? ` · pid ${server.pid}` : ""}
        </span>
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Open port ${server.port}`}
        onClick={() => void ensureLocalApi().shell.openExternal(server.url)}
      >
        <ExternalLinkIcon />
      </Button>
      {server.pid !== null ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Stop process on port ${server.port}`}
          onClick={() => onKill(server)}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
}

function PortsSection() {
  const environmentId = usePrimaryEnvironmentId();
  const { servers } = useDiscoveredPortsState(environmentId);
  const killLocalServer = useAtomCommand(previewEnvironment.killLocalServer, {
    reportFailure: false,
  });
  const ports = [...servers].sort((a, b) => a.port - b.port);

  const onKill = async (server: DiscoveredLocalServer) => {
    if (environmentId === null || server.pid === null) return;
    const result = await killLocalServer({
      environmentId,
      input: { port: server.port, pid: server.pid },
    });
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Port ${server.port} not stopped`,
        description: failure instanceof Error ? failure.message : String(failure),
      });
    }
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button type="button" className={STATUS_BAR_TRIGGER_CLASS} aria-label="Ports" />
              }
            />
          }
        >
          <RadioTowerIcon className="size-3" />
          <span className="tabular-nums">{ports.length}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">Listening ports</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="end" className="w-80">
        <div className="flex max-h-96 flex-col overflow-y-auto">
          <span className="px-2 pb-1 text-xs font-medium">Ports</span>
          {ports.length === 0 ? (
            <span className="px-2 py-1.5 text-xs text-muted-foreground">
              No local servers listening.
            </span>
          ) : (
            ports.map((server) => (
              <PortRow
                key={`${server.host}:${server.port}`}
                server={server}
                onKill={(target) => void onKill(target)}
              />
            ))
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Work VPN (`wg-quick … naowee`); the server asks for the password via polkit. */
function VpnSection() {
  const environmentId = usePrimaryEnvironmentId();
  const setVpn = useAtomCommand(previewEnvironment.setVpn, { reportFailure: false });
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (up?: boolean): Promise<boolean | null> => {
    if (environmentId === null) return null;
    const result = await setVpn({ environmentId, input: up === undefined ? {} : { up } });
    if (result._tag === "Success") {
      setConnected(result.value.connected);
      return result.value.connected;
    }
    if (up !== undefined) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "VPN",
        description: failure instanceof Error ? failure.message : String(failure),
      });
    }
    return null;
  };

  useEffect(() => {
    if (environmentId === null) return;
    let cancelled = false;
    void setVpn({ environmentId, input: {} }).then((result) => {
      if (!cancelled && result._tag === "Success") setConnected(result.value.connected);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, setVpn]);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    // The mount-time read can race the server connection, so read again when unknown.
    const current = connected ?? (await run());
    if (current !== null) await run(!current);
    setBusy(false);
  };

  const Icon = connected ? ShieldCheckIcon : ShieldOffIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={STATUS_BAR_TRIGGER_CLASS}
            aria-label="VPN"
            disabled={busy}
            onClick={() => void onClick()}
          />
        }
      >
        <Icon className={connected ? "size-3 text-success" : "size-3"} />
        <span>{busy ? "VPN…" : "VPN"}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {connected ? "Naowee VPN on, click to disconnect" : "Naowee VPN off, click to connect"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** App-wide bottom bar: usage on the left, ports and existing sessions on the right. */
export const AppStatusBar = memo(function AppStatusBar() {
  return (
    <footer
      data-app-status-bar=""
      className="hidden h-(--app-status-bar-height) shrink-0 items-stretch border-t border-border bg-sidebar px-2 md:flex"
    >
      <FooterUsage />
      <span className="flex-1" />
      <VpnSection />
      <PortsSection />
      <TerminalSessionsButton />
    </footer>
  );
});
