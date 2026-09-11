"use client";

import { SegmentError } from "@/components/ui/segment-error";

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      title="La page Tâches n'a pas pu se charger"
      error={error}
      reset={reset}
    />
  );
}
