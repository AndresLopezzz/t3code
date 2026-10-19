import { FolderIcon, FolderOpenIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import type { SidebarThreadGroup as ThreadGroup } from "../../sidebarThreadGroupStore";

/** A user folder of threads: header toggles it, the rows hang off a guide line. */
export function SidebarThreadGroup(props: {
  readonly group: ThreadGroup;
  readonly onToggle: () => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  readonly children: ReactNode;
}) {
  const Icon = props.group.collapsed ? FolderIcon : FolderOpenIcon;
  return (
    <li className="list-none" data-testid="sidebar-thread-group">
      <button
        type="button"
        aria-expanded={!props.group.collapsed}
        onClick={props.onToggle}
        onContextMenu={props.onContextMenu}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-xs font-semibold tracking-wide text-sidebar-foreground/80 uppercase hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none focus-visible:ring-inset"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
        <span className="truncate">{props.group.name}</span>
        {props.group.collapsed && props.group.threadKeys.length > 0 ? (
          <span className="ms-auto shrink-0 text-2xs font-normal text-sidebar-muted-foreground tabular-nums">
            {props.group.threadKeys.length}
          </span>
        ) : null}
      </button>
      {props.group.collapsed ? null : (
        <ul
          role="presentation"
          className="ms-4 flex flex-col gap-px border-s border-sidebar-border ps-1.5"
        >
          {props.children}
        </ul>
      )}
    </li>
  );
}
