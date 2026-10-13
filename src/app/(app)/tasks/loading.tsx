export default function TasksLoading() {
  return (
    <div role="status" aria-label="Chargement" className="space-y-2 p-6">
      <div className="h-7 w-48 animate-pulse rounded-md bg-surface-muted" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-md bg-surface-muted" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}
