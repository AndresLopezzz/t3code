import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { randomUUID } from "./lib/utils";

export interface SidebarThreadGroup {
  readonly id: string;
  readonly name: string;
  readonly collapsed: boolean;
  /** Scoped thread keys, in the order they were added. */
  readonly threadKeys: readonly string[];
}

interface SidebarThreadGroupState {
  readonly groups: readonly SidebarThreadGroup[];
  /** Creates a group and returns its id; with a thread, moves that thread into it. */
  readonly createGroup: (name: string, threadKey?: string) => string;
  readonly renameGroup: (groupId: string, name: string) => void;
  readonly deleteGroup: (groupId: string) => void;
  readonly toggleGroup: (groupId: string) => void;
  /** Moves a thread into a group, or out of every group with `null`. */
  readonly moveThread: (threadKey: string, groupId: string | null) => void;
}

const withoutThread = (groups: readonly SidebarThreadGroup[], threadKey: string) =>
  groups.map((group) =>
    group.threadKeys.includes(threadKey)
      ? { ...group, threadKeys: group.threadKeys.filter((key) => key !== threadKey) }
      : group,
  );

export const useSidebarThreadGroupStore = create<SidebarThreadGroupState>()(
  persist(
    (set) => ({
      groups: [],
      createGroup: (name, threadKey) => {
        const id = randomUUID();
        set((state) => ({
          groups: [
            ...(threadKey ? withoutThread(state.groups, threadKey) : state.groups),
            { id, name, collapsed: false, threadKeys: threadKey ? [threadKey] : [] },
          ],
        }));
        return id;
      },
      renameGroup: (groupId, name) =>
        set((state) => ({
          groups: state.groups.map((group) => (group.id === groupId ? { ...group, name } : group)),
        })),
      deleteGroup: (groupId) =>
        set((state) => ({ groups: state.groups.filter((group) => group.id !== groupId) })),
      toggleGroup: (groupId) =>
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
          ),
        })),
      moveThread: (threadKey, groupId) =>
        set((state) => ({
          groups: withoutThread(state.groups, threadKey).map((group) =>
            group.id === groupId
              ? { ...group, threadKeys: [...group.threadKeys, threadKey] }
              : group,
          ),
        })),
    }),
    {
      name: "t3code:sidebar-thread-groups:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ groups: state.groups }),
    },
  ),
);
