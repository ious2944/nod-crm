"use client";

import { Archive, Bell, CheckCheck, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { markNotificationsAction, setNotificationPreferenceAction, updateTaskAction } from "@/app/(app)/tasks/work-actions";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/tasks/constants";
import { relativeTime } from "@/lib/tasks/format";
import type { NotificationItem } from "@/lib/tasks/types";

import { fetchJson, useWorkApi } from "./store";
import { Avatar, BTN_GHOST, BTN_PRIMARY, EmptyBlock, ErrorBlock, ICON_BTN, LoadingRows, useUser } from "./ui";

/**
 * Boîte de réception : notifications lues / non lues, archivage, lien vers la
 * tâche (ouverte dans le panneau latéral), et préférences par type.
 */
export function NotificationsView() {
  const { run, openTask, store, reloadContext } = useWorkApi();
  const router = useRouter();
  const [tab, setTab] = useState<"inbox" | "archive" | "prefs">("inbox");
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ items: NotificationItem[]; preferences: Record<string, boolean> }>(`/api/tasks/notifications${tab === "archive" ? "?archived=1" : ""}`);
      setItems(data.items);
      setPrefs(data.preferences);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [tab]);
  useEffect(() => {
    // Chargement des données : l'état n'est mis à jour qu'au retour du réseau.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => store.register({ scope: (e) => e.kind === "notification" || e.forMe, reload: load }), [load, store]);

  const mark = async (ids: string[] | "all", change: { read?: boolean; archived?: boolean }) => {
    setItems((list) =>
      list?.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, readAt: change.read === undefined ? n.readAt : change.read ? new Date().toISOString() : null } : n)).filter((n) => (change.archived === undefined ? true : ids !== "all" && !ids.includes(n.id))) ?? null,
    );
    await run(() => markNotificationsAction(ids, change));
    void reloadContext();
  };

  const visible = (items ?? []).filter((n) => !unreadOnly || !n.readAt);
  const unread = (items ?? []).filter((n) => !n.readAt).length;

  return (
    <div className="h-[85dvh] overflow-y-auto md:h-dvh">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface px-4 py-3">
        <h1 className="flex-1 text-[18px] font-semibold text-ink">Notifications</h1>
        {tab === "inbox" && unread > 0 && (
          <button type="button" className={BTN_GHOST} onClick={() => void mark("all", { read: true })}>
            <CheckCheck className="h-3.5 w-3.5" /> Tout marquer comme lu
          </button>
        )}
      </header>
      <nav role="tablist" aria-label="Notifications" className="flex gap-1 border-b border-border-subtle bg-surface px-4">
        {([
          ["inbox", `Boîte de réception${unread && tab === "inbox" ? ` (${unread})` : ""}`],
          ["archive", "Archivées"],
          ["prefs", "Préférences"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setItems(null); }} className={`border-b-2 px-3 py-2 text-[13px] font-medium ${tab === key ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </nav>
      <div className="mx-auto max-w-3xl p-4">
        {error && <ErrorBlock message={error} onRetry={() => void load()} />}
        {tab === "prefs" ? (
          <Preferences prefs={prefs} onChange={async (type, value) => { setPrefs((p) => ({ ...p, [type]: value })); if ((await run(() => setNotificationPreferenceAction(type, value))) === null) setPrefs((p) => ({ ...p, [type]: !value })); }} />
        ) : !items ? (
          <LoadingRows rows={5} />
        ) : (
          <>
            {tab === "inbox" && items.length > 0 && (
              <label className="mb-2 flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-[var(--nod-accent)]" />
                Non lues uniquement
              </label>
            )}
            {visible.length === 0 ? (
              <EmptyBlock icon={tab === "archive" ? Archive : Inbox} title={tab === "archive" ? "Aucune notification archivée" : "Vous êtes à jour"} description={tab === "inbox" ? "Affectations, mentions, commentaires et changements importants sur vos tâches suivies apparaîtront ici." : undefined} />
            ) : (
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
                {visible.map((n) => (
                  <NotificationRow
                    key={n.id}
                    item={n}
                    archived={tab === "archive"}
                    onOpen={() => {
                      if (!n.readAt) void mark([n.id], { read: true });
                      if (n.taskId) openTask(n.taskId);
                      else if (n.projectId) router.push(`/tasks/projects/${n.projectId}?view=overview`);
                    }}
                    onToggleRead={() => void mark([n.id], { read: !n.readAt })}
                    onArchive={() => void mark([n.id], { archived: tab !== "archive", read: true })}
                    onComplete={async () => {
                      if (!n.taskId) return;
                      const ok = await run(() => updateTaskAction(n.taskId!, { status: "DONE" }), "Tâche terminée.");
                      if (ok) {
                        store.upsertTasks([ok]);
                        void mark([n.id], { archived: true, read: true });
                      }
                    }}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ item, archived, onOpen, onToggleRead, onArchive, onComplete }: { item: NotificationItem; archived: boolean; onOpen: () => void; onToggleRead: () => void; onArchive: () => void; onComplete: () => void }) {
  const actor = useUser(item.actorId);
  const unread = !item.readAt;
  return (
    <li className={`group flex items-start gap-3 px-3 py-2.5 ${unread ? "bg-accent-soft/40" : ""}`}>
      <span className="relative mt-0.5">
        {actor ? <Avatar user={actor} size={28} /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-muted text-muted"><Bell className="h-3.5 w-3.5" /></span>}
        {unread && <span aria-label="Non lue" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />}
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className={`text-[13px] ${unread ? "font-semibold text-ink" : "text-ink"}`}>{item.title}</p>
        {item.body && <p className="truncate text-[12px] text-muted">{item.body}</p>}
        <p className="text-[11px] text-muted">
          {actor ? `${actor.name} · ` : ""}
          {relativeTime(item.createdAt)}
        </p>
      </button>
      {item.actionKind === "COMPLETE_TASK" && !archived && (
        <button type="button" className={BTN_PRIMARY} onClick={onComplete}>
          Terminer la tâche
        </button>
      )}
      <span className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
        <button type="button" className={`${ICON_BTN} w-auto px-1.5 text-[11px]`} onClick={onToggleRead}>
          {unread ? "Marquer lu" : "Marquer non lu"}
        </button>
        <button type="button" className={ICON_BTN} aria-label={archived ? "Désarchiver" : "Archiver"} title={archived ? "Désarchiver" : "Archiver"} onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  );
}

function Preferences({ prefs, onChange }: { prefs: Record<string, boolean>; onChange: (type: string, value: boolean) => void }) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4">
      <h2 className="mb-1 text-[14px] font-semibold text-ink">Recevoir une notification quand…</h2>
      <p className="mb-3 text-[12px] text-muted">
        Les notifications s&apos;affichent dans NOD CRM. L&apos;envoi par e-mail n&apos;est pas disponible : l&apos;instance ne dispose d&apos;aucun serveur d&apos;envoi configuré.
      </p>
      <ul className="space-y-2">
        {(Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => (
          <li key={type}>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={prefs[type] !== false} onChange={(e) => onChange(type, e.target.checked)} className="accent-[var(--nod-accent)]" />
              {NOTIFICATION_TYPES[type]}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
