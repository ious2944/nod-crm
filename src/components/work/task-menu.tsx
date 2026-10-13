"use client";

import {
  CircleCheck,
  Copy,
  ExternalLink,
  FolderInput,
  Link as LinkIcon,
  PanelRight,
  Trash,
  Undo2,
} from "lucide-react";
import { useState } from "react";

import type { TaskItem } from "@/lib/tasks/types";

import { ProjectSectionPanel } from "./pickers";
import { useWorkApi } from "./store";
import type { TaskOps } from "./task-ops";
import { ConfirmModal, Popover, type MenuEntry } from "./ui";

/**
 * Actions d'une tâche, communes au menu contextuel, au bouton « … » et au
 * panneau : terminer/rouvrir, ouvrir, dupliquer, déplacer, rattacher à un
 * autre projet, copier le lien, supprimer.
 */
export function useTaskMenu(ops: TaskOps, projectId: string | null) {
  const { openTask } = useWorkApi();
  const [confirm, setConfirm] = useState<TaskItem | null>(null);
  const [picker, setPicker] = useState<{ task: TaskItem; mode: "move" | "add"; x: number; y: number } | null>(null);

  const items = (task: TaskItem, point?: { x: number; y: number }): MenuEntry[] => {
    const at = point ?? { x: window.innerWidth / 2 - 130, y: window.innerHeight / 3 };
    const entries: MenuEntry[] = [
      { label: "Ouvrir les détails", icon: PanelRight, onSelect: () => openTask(task.id), hint: "Entrée" },
      {
        label: task.status === "DONE" ? "Rouvrir" : "Marquer comme terminée",
        icon: task.status === "DONE" ? Undo2 : CircleCheck,
        disabled: !task.canEdit,
        onSelect: () => void ops.toggleComplete(task),
        hint: "Ctrl+Entrée",
      },
      { label: "Dupliquer", icon: Copy, disabled: !task.canEdit, onSelect: () => void ops.duplicate(task) },
      { label: "Copier le lien", icon: LinkIcon, onSelect: () => void ops.copyLink(task) },
      { label: "Ouvrir dans un nouvel onglet", icon: ExternalLink, onSelect: () => window.open(`/tasks/t/${task.id}`, "_blank", "noopener") },
    ];
    if (!task.parentId) {
      entries.push({ separator: true });
      if (projectId) {
        entries.push({ label: "Déplacer vers un autre projet…", icon: FolderInput, disabled: !task.canEdit, onSelect: () => setPicker({ task, mode: "move", ...at }) });
      }
      entries.push({ label: "Ajouter à un autre projet…", icon: FolderInput, disabled: !task.canEdit, onSelect: () => setPicker({ task, mode: "add", ...at }) });
    }
    entries.push({ separator: true }, { label: "Supprimer", icon: Trash, danger: true, disabled: !task.canEdit, onSelect: () => setConfirm(task), hint: "Suppr" });
    return entries;
  };

  const element = (
    <>
      <ConfirmModal
        open={confirm !== null}
        title="Supprimer la tâche ?"
        description={
          confirm ? (
            <>
              « {confirm.title} » sera supprimée définitivement
              {confirm.subtaskCount ? `, avec ses ${confirm.subtaskCount} sous-tâche(s)` : ""}, ainsi que ses commentaires et pièces jointes.
              {confirm.memberships.length > 1 && " Elle disparaîtra de tous ses projets."}
            </>
          ) : null
        }
        confirmLabel="Supprimer"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await ops.remove(confirm);
          setConfirm(null);
        }}
      />
      {picker && (
        <Popover open anchor={{ x: picker.x, y: picker.y }} onClose={() => setPicker(null)} label="Choisir un projet">
          <ProjectSectionPanel
            title={picker.mode === "move" ? "Déplacer vers" : "Ajouter à"}
            excludeProjectIds={picker.mode === "add" ? picker.task.memberships.map((m) => m.projectId) : projectId ? [projectId] : []}
            onPick={async (targetProject, sectionId) => {
              const task = picker.task;
              setPicker(null);
              if (picker.mode === "add") {
                await ops.addToProject(task, targetProject, sectionId);
              } else {
                const moved = await ops.move(task, targetProject, sectionId);
                if (moved && projectId) await ops.removeFromProject(moved, projectId);
              }
            }}
          />
        </Popover>
      )}
    </>
  );

  return { items, element, askDelete: setConfirm };
}
