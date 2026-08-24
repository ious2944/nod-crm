"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { findContacts } from "@/app/(app)/contacts/actions";
import { FIELD, FieldError, LABEL } from "@/components/ui/form";
import type { ContactPickerOption } from "@/lib/contacts/queries";

/**
 * Sélecteur de contact du formulaire Follow-Up.
 *
 * Remplace la liste déroulante de la V0.1, qui chargeait *tous* les contacts du
 * workspace dans la page. Ici la recherche est faite par PostgreSQL et le
 * résultat est plafonné : le navigateur ne reçoit que ce qu'il affiche.
 *
 * Le contrat du formulaire n'a pas changé — c'est ce qui garantit la
 * non-régression côté serveur. Le champ envoyé s'appelle toujours `contactId`
 * et vaut toujours `""` (aucun contact), `"new"` (création rapide) ou l'UUID
 * d'un contact existant.
 */

const DEBOUNCE_MS = 250;

export interface PickerSelection {
  id: string;
  name: string;
}

export function ContactPicker({
  defaultSelection,
  mode,
  onModeChange,
  error,
}: {
  /** Contact pré-sélectionné (fiche contact → « + Nouveau Follow-Up »). */
  defaultSelection?: PickerSelection;
  /** `""`, `"new"` ou un UUID — la valeur réellement postée. */
  mode: string;
  onModeChange: (mode: string) => void;
  error?: string;
}) {
  const [selection, setSelection] = useState<PickerSelection | null>(
    defaultSelection ?? null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactPickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputId = useId();
  const listId = useId();

  // Les réponses peuvent revenir dans le désordre : seule celle de la dernière
  // requête émise est affichée, sinon un résultat périmé écrase le bon.
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
        const found = await findContacts(query);
        if (current === requestId.current) setResults(found);
      } catch {
        if (current === requestId.current) setResults([]);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open]);

  const choose = (option: ContactPickerOption) => {
    setSelection({ id: option.id, name: option.name });
    onModeChange(option.id);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    setSelection(null);
    onModeChange("");
    setOpen(false);
    setQuery("");
  };

  return (
    <div>
      <label className={LABEL} htmlFor={inputId}>
        Contact
      </label>

      {/* La valeur réellement postée. Le champ visible ne sert qu'à chercher. */}
      <input type="hidden" name="contactId" value={mode} />

      {selection && mode === selection.id ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2">
          <span className="min-w-0 truncate text-sm text-ink">{selection.name}</span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
          >
            Changer
          </button>
        </div>
      ) : mode === "new" ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2">
          <span className="text-sm text-ink">Nouveau contact</span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink"
          >
            Annuler
          </button>
        </div>
      ) : (
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
            placeholder="Rechercher un contact..."
            className={FIELD}
          />

          {open && (
            <div
              id={listId}
              role="listbox"
              aria-label="Contacts"
              className="nod-rise absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1.5 shadow-lg"
            >
              <PickerButton onSelect={clear}>— Aucun contact —</PickerButton>

              {results.map((option) => (
                <PickerButton key={option.id} onSelect={() => choose(option)}>
                  <span className="block truncate text-ink">{option.name}</span>
                  {option.subtitle && (
                    <span className="block truncate text-xs text-muted">{option.subtitle}</span>
                  )}
                </PickerButton>
              ))}

              {!loading && results.length === 0 && query && (
                <p className="px-2.5 py-2 text-xs text-muted">Aucun contact trouvé.</p>
              )}

              <PickerButton
                onSelect={() => {
                  setSelection(null);
                  onModeChange("new");
                  setOpen(false);
                }}
              >
                <span className="text-accent">+ Créer un contact</span>
              </PickerButton>
            </div>
          )}
        </div>
      )}

      <FieldError message={error} />
    </div>
  );
}

function PickerButton({
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
