import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import type { ProviderDriverKind } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  formatDuration,
  formatResetsIn,
  remainingPercent,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useNowMinute } from "../../hooks/useNowMinute";
import { ensureLocalApi } from "../../localApi";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { barColor, resetCreditsSummary } from "./UsageLimits";
import { tightestUsageWindow } from "./footerUsage.logic";

export function FooterUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const accounts = collectLimitAccounts(presentations);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const results = await Promise.all(
        [...presentations]
          .filter(([, value]) => value.connection.phase === "connected")
          .map(([environmentId]) =>
            refreshUsageLimits(environmentId, () =>
              refreshProviders({ environmentId, input: { fresh: true } }),
            ),
          ),
      );
      if (results.some((result) => result?._tag === "Failure"))
        toastManager.add({ type: "error", title: "Some usage limits could not be refreshed" });
    } catch {
      toastManager.add({ type: "error", title: "Usage limits could not be refreshed" });
    } finally {
      setRefreshing(false);
    }
  };
  const now = Date.parse(`${useNowMinute()}:00.000Z`);
  // One chip per account so two accounts of the same provider can be watched side by side.
  const groups = new Map<ProviderDriverKind, LimitAccount[]>();
  for (const account of accounts) {
    const group = groups.get(account.driver) ?? [];
    group.push(account);
    groups.set(account.driver, group);
  }
  return (
    <div className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {accounts.map((account) => (
        <ProviderUsageChip
          key={account.key}
          driver={account.driver}
          accounts={groups.get(account.driver)!}
          initialKey={account.key}
          now={now}
        />
      ))}
      {accounts.length > 0 ? (
        <button
          type="button"
          className="footer-usage-trigger"
          aria-label="Refresh usage limits"
          disabled={refreshing}
          onClick={() => void refreshAll()}
        >
          <RefreshIcon size="xs" refreshing={refreshing} />
        </button>
      ) : null}
    </div>
  );
}

function ProviderUsageChip({
  driver,
  accounts,
  initialKey,
  now,
}: {
  driver: ProviderDriverKind;
  accounts: readonly LimitAccount[];
  initialKey: string;
  now: number;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const [showAccounts, setShowAccounts] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const account = accounts.find((item) => item.key === selectedKey) ?? accounts[0]!;
  const label = providerClients.get(driver)?.label ?? String(driver);
  const color = account.accentColor ?? barColor(driver);
  const windows = account.limits.windows;
  const tightest = tightestUsageWindow(windows);
  const updatedAgo = formatDuration(Math.max(0, now - Date.parse(account.limits.checkedAt)));

  const refresh = async (automatic = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        [
          ...new Set([
            ...account.environments.map((environment) => environment.environmentId),
            ...(account.redeem ? [account.redeem.environmentId] : []),
          ]),
        ].map((environmentId) =>
          refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: { fresh: !automatic } }),
            automatic,
          ),
        ),
      );
      if (results.some((result) => result?._tag === "Failure"))
        setError("Could not refresh. Showing the last available snapshot.");
    } catch {
      setError("Could not refresh. Showing the last available snapshot.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setShowAccounts(false);
        setShowEmail(false);
        if (next) void refresh(true);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="footer-usage-trigger"
            aria-label={`${label} usage details`}
          />
        }
      >
        <ProviderInstanceIcon
          driverKind={driver}
          displayName={label}
          className="size-3.5"
          iconClassName="size-3.5"
        />
        {accounts.length > 1 ? (
          <span className="max-w-24 truncate">{account.displayName ?? account.plan ?? label}</span>
        ) : null}
        {tightest ? (
          <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="block h-full rounded-full"
              style={{ width: `${tightest.usedPercent}%`, backgroundColor: color }}
            />
          </span>
        ) : null}
        {windows.map((window, index) => (
          <span key={window.id} className="flex items-center gap-1 whitespace-nowrap tabular-nums">
            {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
            {Math.round(window.usedPercent)}%
            <span className="text-muted-foreground/70">
              {window.resetsAt
                ? formatDuration(Math.max(0, Date.parse(window.resetsAt) - now))
                : window.label}
            </span>
          </span>
        ))}
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="start"
        width="md"
        padding="compact"
        aria-label={`${label} usage`}
      >
        <div className="px-2 pb-2 pt-1">
          {showAccounts ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Back to usage"
                  onClick={() => setShowAccounts(false)}
                >
                  <ChevronLeftIcon />
                </Button>
                <span className="text-xs font-medium">{label} accounts</span>
              </div>
              <div className="space-y-1">
                {accounts.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="footer-usage-account"
                    aria-pressed={item.key === account.key}
                    onClick={() => {
                      setSelectedKey(item.key);
                      setShowAccounts(false);
                      setShowEmail(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.displayName ?? item.plan ?? label}
                      <span className="block truncate text-2xs text-muted-foreground">
                        {item.environments.map((environment) => environment.label).join(", ") ||
                          item.sourceLabel}
                      </span>
                    </span>
                    <span className="text-2xs tabular-nums">
                      {tightestUsageWindow(item.limits.windows)
                        ? `${remainingPercent(tightestUsageWindow(item.limits.windows)!)}% left`
                        : "No quota data"}
                    </span>
                  </button>
                ))}
              </div>
              <Button size="xs" variant="ghost" render={<Link to="/settings/providers" />}>
                Manage accounts
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2.5 pb-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
                  <ProviderInstanceIcon
                    driverKind={driver}
                    displayName={label}
                    className="size-4"
                    iconClassName="size-4"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xs font-medium">{label} usage</h2>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    Updated {updatedAgo || "0m"} ago
                  </p>
                </div>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Refresh ${label} usage`}
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RefreshIcon refreshing={busy} />
                </Button>
              </div>
              <div className="mb-2 flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => setShowAccounts(true)}
                  aria-label={`Choose ${label} account`}
                >
                  <span className="truncate">
                    {account.displayName ?? "Default account"}
                    {account.plan ? ` · ${account.plan}` : ""}
                  </span>
                  <ChevronRightIcon className="size-3 shrink-0" />
                </button>
                {account.email ? (
                  <button
                    type="button"
                    className="min-w-0 truncate rounded px-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={showEmail ? "Hide account email" : "Reveal account email"}
                    onClick={() => setShowEmail((shown) => !shown)}
                  >
                    {showEmail ? account.email : "••••••"}
                  </button>
                ) : null}
              </div>
              {error || account.limits.unavailable?.message ? (
                <p className="mb-2 text-2xs text-warning-foreground" role="status">
                  {error ?? account.limits.unavailable?.message}
                </p>
              ) : null}
              <div className="space-y-1.5">
                {windows.map((window) => (
                  <div
                    key={window.id}
                    className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 text-2xs tabular-nums"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{window.label}</span>
                      <span className="shrink-0">{Math.round(window.usedPercent)}% used</span>
                    </div>
                    <div
                      role="meter"
                      aria-label={window.label}
                      aria-valuenow={window.usedPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${window.usedPercent}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between gap-2 text-muted-foreground">
                      <span>{remainingPercent(window)}% remaining</span>
                      <span>{formatResetsIn(window, now) ?? "Reset time unavailable"}</span>
                    </div>
                  </div>
                ))}
              </div>
              {windows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">No quota data available.</p>
              ) : null}
              {account.limits.resetCredits ? (
                <p className="mt-2 text-2xs text-muted-foreground">
                  {resetCreditsSummary(account.limits.resetCredits, now)}
                </p>
              ) : null}
              {account.limits.externalUsage ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void ensureLocalApi().shell.openExternal(account.limits.externalUsage!.url)
                  }
                >
                  {account.limits.externalUsage.label}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
