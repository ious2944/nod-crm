"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { deleteOpportunity } from "@/app/(app)/commerce/actions";

/**
 * Bouton de suppression d'une opportunité avec confirmation.
 *
 * Après la suppression, redirige vers `/commerce`. Les tâches et suivis liés
 * conservent leurs données mais perdent le lien à l'opportunité (SetNull).
 */
export function DeleteOpportunityButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const confirmed = window.confirm(
      "Supprimer cette opportunité ? Les tâches et suivis associés seront conservés mais ne seront plus liés à cette opportunité.",
    );
    if (!confirmed) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", opportunityId);
      await deleteOpportunity(formData);
      router.push("/commerce");
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-critical-fg hover:bg-critical-bg disabled:cursor-progress disabled:opacity-60"
    >
      {isPending ? "Suppression…" : "Supprimer"}
    </button>
  );
}
