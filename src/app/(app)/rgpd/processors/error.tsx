"use client";

import { SegmentError } from "@/components/ui/segment-error";

export default function ProcessorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      title="Le module Sous-traitants n'a pas pu se charger"
      error={error}
      reset={reset}
    />
  );
}
