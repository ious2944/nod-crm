import Link from "next/link";

/** Fil d'Ariane à 2 niveaux maximum pour la navigation contextuelle. */
export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Fil d'Ariane">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="select-none text-muted/50">
                  ›
                </span>
              )}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-ink" : ""}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-ink hover:underline underline-offset-2 transition-colors"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
