import { memo } from "react";

export const SidebarJiraBadge = memo(function SidebarJiraBadge(props: {
  readonly issueKey: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${props.issueKey} in Jira`}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen();
      }}
      className="shrink-0 cursor-pointer rounded px-1 font-mono text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {props.issueKey}
    </button>
  );
});
