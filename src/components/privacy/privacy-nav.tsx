const ITEMS = [
  ["Vue d’ensemble", "/rgpd"],
  ["Traitements", "/rgpd/treatments"],
  ["Sous-traitants", "/rgpd/processors"],
  ["Demandes", "/rgpd/requests"],
  ["Incidents", "/rgpd/incidents"],
] as const;

export function PrivacyNav({ current }: { current: string }) {
  return (
    <nav aria-label="Navigation RGPD" className="flex gap-2 overflow-x-auto pb-1">
      {ITEMS.map(([label, href]) => (
        <a
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
            current === href
              ? "bg-accent text-accent-contrast"
              : "border border-border-strong bg-surface text-muted hover:bg-surface-muted hover:text-ink"
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export function PrivacyPageHeader({
  current,
  title,
  description,
}: {
  current: string;
  title: string;
  description: string;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">RGPD Essentials</p>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        <PrivacyNav current={current} />
      </div>
    </header>
  );
}
