"use client";

import { SegmentError } from "@/components/ui/segment-error";

export default function ContactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      title="Le module Contacts n'a pas pu se charger"
      error={error}
      reset={reset}
    />
  );
}
