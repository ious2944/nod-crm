/**
 * État du formulaire d'édition d'un sous-traitant.
 *
 * Utilisé avec `useActionState` côté client, et retourné par `updateProcessor`
 * côté serveur. Défini dans `lib/` pour être importé sans directive de build.
 */

export type ProcessorFormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export const initialProcessorFormState: ProcessorFormState = { status: "idle" };
