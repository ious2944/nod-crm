"use client";

import { SegmentError } from "@/components/ui/segment-error";

export default function IncidentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      title="Le module Incidents n'a pas pu se charger"
      error={error}
      reset={reset}
    />
  );
}
