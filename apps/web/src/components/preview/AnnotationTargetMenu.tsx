import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessageSquareShareIcon } from "lucide-react";
import { useMemo } from "react";

import { useThreadShells } from "~/state/entities";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const MAX_TARGETS = 15;

/** Picks which chat receives preview annotations; `null` is the chat that owns the preview. */
export function AnnotationTargetMenu(props: {
  readonly threadRef: ScopedThreadRef;
  readonly target: ScopedThreadRef | null;
  readonly onTargetChange: (target: ScopedThreadRef | null) => void;
}) {
  const threads = useThreadShells();
  const ownKey = scopedThreadKey(props.threadRef);
  // Unarchived chats not settled away, newest first, like the sidebar's active list.
  const others = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            thread.settledOverride !== "settled" &&
            (thread.settledAt === null || thread.settledOverride === "active") &&
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) !== ownKey,
        )
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, MAX_TARGETS),
    [threads, ownKey],
  );
  const value = props.target === null ? "" : scopedThreadKey(props.target);
  const targetTitle =
    props.target === null
      ? null
      : threads.find(
          (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === value,
        )?.title;

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  variant={props.target === null ? "ghost" : "secondary"}
                  size="icon-xs"
                  aria-label="Annotation target chat"
                  type="button"
                />
              }
            />
          }
        >
          <MessageSquareShareIcon className={props.target === null ? undefined : "text-primary"} />
        </TooltipTrigger>
        <TooltipPopup>
          {targetTitle ? `Annotations go to: ${targetTitle}` : "Annotations go to this chat"}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="max-w-72">
        <MenuGroupLabel>Send annotations to</MenuGroupLabel>
        <MenuRadioGroup
          value={value}
          onValueChange={(next: string) => {
            const thread = others.find(
              (candidate) =>
                scopedThreadKey(scopeThreadRef(candidate.environmentId, candidate.id)) === next,
            );
            props.onTargetChange(thread ? scopeThreadRef(thread.environmentId, thread.id) : null);
          }}
        >
          <MenuRadioItem value="" closeOnClick>
            <span>This chat</span>
          </MenuRadioItem>
          {others.map((thread) => {
            const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
            return (
              <MenuRadioItem key={key} value={key} closeOnClick>
                <span className="truncate">{thread.title || "Untitled"}</span>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
