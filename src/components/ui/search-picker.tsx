"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FIELD, FieldError, LABEL } from "@/components/ui/form";

/**
 * Sélecteur « chercher puis choisir », partagé par les formulaires.
 *
 * Extrait du sélecteur de contact de la V0.2 quand le formulaire de tâche a eu
 * besoin du même comportement pour les suivis. Ce qui est partagé, ce n'est pas
 * de l'habillage mais trois détails durement acquis :
 *
 * - la **recherche est faite côté serveur** et plafonnée : le navigateur ne
 *   reçoit jamais l'annuaire ni le tableau de bord complet ;
 * - les réponses peuvent revenir **dans le désordre** — seule celle de la
 *   dernière requête émise est affichée, sinon un résultat périmé écrase le bon ;
 * - la liste ne se ferme **qu'après** le clic (`mousedown` avant `blur`), sinon
 *   le choix de l'utilisateur est perdu au moment précis où il le fait.
 *
 * Le contrat de formulaire reste celui de chaque module : ce composant se
 * contente de poster `value` dans un champ caché nommé `name`.
 */

const DEBOUNCE_MS = 250;

export interface PickerOption {
  id: string;
  name: string;
  subtitle: string | null;
}

export function SearchPicker({
  name,
  label,
  placeholder,
  noneLabel,
  emptyLabel,
  search,
  value,
  selectionName,
  onSelect,
  onClear,
  extraOptions,
  error,
}: {
  /** Nom du champ réellement posté. */
  name: string;
  label: string;
  placeholder: string;
  /** Première option de la liste : se passer de lien. */
  noneLabel: string;
  /** Message affiché quand la recherche ne donne rien. */
  emptyLabel: string;
  search: (query: string) => Promise<PickerOption[]>;
  /** Valeur postée : `""` ou l'identifiant choisi. */
  value: string;
  /** Libellé de la sélection courante, quand `value` est un identifiant. */
  selectionName: string | null;
  onSelect: (option: PickerOption) => void;
  onClear: () => void;
  /** Options supplémentaires en fin de liste (ex. « + Créer un contact »). */
  extraOptions?: (close: () => void) => ReactNode;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputId = useId();
  const listId = useId();

  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;

    const current = ++requestId.current;

    const timer = setTimeout(async () => {
      // `setLoading` vit dans le minuteur, pas dans le corps de l'effet : un
      // `setState` synchrone y déclencherait un rendu en cascade à chaque
      // frappe, ce que la règle `react-hooks/set-state-in-effect` signale.
      setLoading(true);
      try {
        const found = await search(query);
        if (current === requestId.current) setResults(found);
      } catch {
        if (current === requestId.current) setResults([]);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open, search]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  if (selectionName !== null) {
    return (
      <div>
        <p className={LABEL}>{label}</p>
        <input type="hidden" name={name} value={value} />
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2">
          <span className="min-w-0 truncate text-sm text-ink">{selectionName}</span>
          <button
            type="button"
            onClick={() => {
              onClear();
              close();
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
          >
            Changer
          </button>
        </div>
        <FieldError message={error} />
      </div>
    );
  }

  return (
    <div>
      <label className={LABEL} htmlFor={inputId}>
        {label}
      </label>

      {/* La valeur réellement postée. Le champ visible ne sert qu'à chercher. */}
      <input type="hidden" name={name} value={value} />

      <div className="relative mt-1">
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          // `blur` sans délai fermerait la liste avant que le clic sur un
          // résultat ne soit enregistré.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className={FIELD}
        />

        {open && (
          <div
            id={listId}
            role="listbox"
            aria-label={label}
            className="nod-rise absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1.5 shadow-lg"
          >
            <PickerButton
              onSelect={() => {
                onClear();
                close();
              }}
            >
              {noneLabel}
            </PickerButton>

            {results.map((option) => (
              <PickerButton
                key={option.id}
                onSelect={() => {
                  onSelect(option);
                  close();
                }}
              >
                <span className="block truncate text-ink">{option.name}</span>
                {option.subtitle && (
                  <span className="block truncate text-xs text-muted">{option.subtitle}</span>
                )}
              </PickerButton>
            ))}

            {!loading && results.length === 0 && query && (
              <p className="px-2.5 py-2 text-xs text-muted">{emptyLabel}</p>
            )}

            {extraOptions?.(close)}
          </div>
        )}
      </div>

      <FieldError message={error} />
    </div>
  );
}

export function PickerButton({
  onSelect,
  children,
}: {
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      // `mousedown` plutôt que `click` : il se déclenche avant le `blur` du
      // champ de recherche, donc avant que la liste ne se referme.
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
      onClick={onSelect}
      className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-muted"
    >
      {children}
    </button>
  );
}
