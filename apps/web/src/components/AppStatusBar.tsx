import type { DiscoveredLocalServer, ServerProvider } from "@t3tools/contracts";
import { formatResetsIn, providersWithLimits, remainingPercent } from "@t3tools/shared/usageLimits";
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
import {
  usePrimaryEnvironment,
  usePrimaryEnvironmentId,
  useEnvironmentProviders,
} from "../state/environments";
import { previewEnvironment } from "../state/preview";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { ClaudeAI } from "./Icons";
import { providerClients } from "./settings/providerDriverMeta";
import { TerminalSessionsButton } from "./TerminalSessionsButton";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { barColor, LimitWindows } from "./usage/UsageLimits";

const EMPTY_PROVIDERS: readonly ServerProvider[] = [];

const STATUS_BAR_TRIGGER_CLASS =
  "flex h-full shrink-0 items-center gap-1.5 px-2 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground";

/** Driver label, plus the instance name when it adds something (a second account). */
function providerLabel(provider: ServerProvider): string {
  const driver = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  const instance = provider.displayName?.trim();
  return instance && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

/** The default Claude home is the personal account; yellow tells it from the work one. */
function isPersonalClaude(provider: ServerProvider): boolean {
  return String(provider.instanceId) === "claudeAgent";
}

function accountColor(provider: ServerProvider): string {
  return isPersonalClaude(provider) ? "var(--warning)" : barColor(provider.driver);
}

function MiniBar({ percent, color }: { readonly percent: number; readonly color: string }) {
  return (
    <span className="h-1 w-6 shrink-0 overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </span>
  );
}

/** One provider at a glance: quota left and countdown, as the usage panel reads it. */
function ProviderSummary({
  provider,
  now,
}: {
  readonly provider: ServerProvider;
  readonly now: number;
}) {
  const color = accountColor(provider);
  const windows = provider.usageLimits?.windows ?? [];
  // The 5h window is what runs out first; the rest goes in the tooltip.
  const session = windows.find((window) => window.kind === "session") ?? windows[0];
  const others = windows.filter((window) => window !== session);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex items-center gap-1.5 tabular-nums" />}
        aria-label={providerLabel(provider)}
      >
        {isPersonalClaude(provider) ? (
          <ClaudeAI className="size-3.5 shrink-0 fill-warning" aria-hidden />
        ) : (
          <ProviderInstanceIcon
            driverKind={provider.driver}
            displayName={providerLabel(provider)}
            className="size-3.5"
            iconClassName="size-3.5"
          />
        )}
        {session ? (
          <>
            <MiniBar percent={remainingPercent(session)} color={color} />
            {remainingPercent(session)}% left
            <span className="text-muted-foreground/70">{formatResetsIn(session, now) ?? ""}</span>
          </>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="flex flex-col gap-0.5 tabular-nums">
          <span className="font-medium">{providerLabel(provider)}</span>
          {others.map((window) => (
            <span key={window.id}>
              {window.label}: {remainingPercent(window)}% left
              {formatResetsIn(window, now) ? ` · ${formatResetsIn(window, now)}` : ""}
            </span>
          ))}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

function UsageSection() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentProviders = useEnvironmentProviders();
  const providers = providersWithLimits(
    (primaryEnvironment ? environmentProviders.get(primaryEnvironment.environmentId) : undefined) ??
      EMPTY_PROVIDERS,
  ).filter((provider) => (provider.usageLimits?.windows.length ?? 0) > 0);
  const [now, setNow] = useState(() => Date.now());
  if (providers.length === 0) return null;

  return (
    <Popover onOpenChange={(open) => open && setNow(Date.now())}>
      <PopoverTrigger
        render={
          <button type="button" className={STATUS_BAR_TRIGGER_CLASS} aria-label="Usage limits" />
        }
      >
        <span className="flex items-center gap-4">
          {providers.map((provider) => (
            <ProviderSummary key={provider.instanceId} provider={provider} now={now} />
          ))}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="w-80">
        <div className="flex flex-col gap-3">
          {providers.map((provider) => (
            <div key={provider.instanceId} className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-xs font-medium">{providerLabel(provider)}</span>
              <LimitWindows
                compact
                driver={provider.driver}
                color={accountColor(provider)}
                windows={provider.usageLimits?.windows ?? []}
                now={now}
              />
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

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
    <footer className="hidden h-(--app-status-bar-height) shrink-0 items-stretch border-t border-border bg-sidebar px-2 md:flex">
      <UsageSection />
      <span className="flex-1" />
      <VpnSection />
      <PortsSection />
      <TerminalSessionsButton />
    </footer>
  );
});
