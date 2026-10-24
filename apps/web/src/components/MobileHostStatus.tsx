import { BatteryChargingIcon, BatteryIcon, ThermometerIcon } from "lucide-react";
import { useEffect } from "react";

import { useIsMobile } from "../hooks/useMediaQuery";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

/** Poll only while the phone browser is visible; recover immediately on return. */
export function MobileHostStatus() {
  const mobile = useIsMobile();
  const thread = useThreadRouteRef();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = thread?.environmentId ?? primaryEnvironmentId;
  const status = useEnvironmentQuery(
    mobile && environmentId ? serverEnvironment.hostResources({ environmentId, input: {} }) : null,
  );
  const refresh = status.refresh;
  useEffect(() => {
    if (!mobile || !environmentId) return;
    const update = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [mobile, environmentId, refresh]);
  if (!mobile || !environmentId) return null;
  const battery = status.data?.batteryPercent;
  const temperature = status.data?.cpuTemperatureCelsius;
  const charging = status.data?.batteryState === "charging";
  const Battery = charging ? BatteryChargingIcon : BatteryIcon;
  const stale = status.error !== null;
  return (
    <div
      role="status"
      aria-label="Batería y temperatura del portátil"
      className="shrink-0 border-t border-border bg-sidebar pb-safe md:hidden"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-2 py-1 text-2xs text-muted-foreground tabular-nums">
        <span>Portátil</span>
        <span className="inline-flex items-center gap-1">
          <span className="sr-only">Batería:</span>
          <Battery className="size-3.5" aria-hidden />
          {battery == null ? "sin datos" : `${Math.round(battery)}%`}
          {charging ? " · cargando" : ""}
        </span>
        <span className="inline-flex items-center gap-1">
          <ThermometerIcon className="size-3.5" aria-hidden />
          CPU {temperature == null ? "sin datos" : `${Math.round(temperature)} °C`}
        </span>
        {stale ? (
          <span>· sin actualizar</span>
        ) : status.isPending && !status.data ? (
          <span>…</span>
        ) : null}
      </div>
    </div>
  );
}
