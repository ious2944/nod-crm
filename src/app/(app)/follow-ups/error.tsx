"use client";

import { SegmentError } from "@/components/ui/segment-error";

export default function FollowUpsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      title="Le module Follow-up n'a pas pu se charger"
      error={error}
      reset={reset}
    />
  );
}
