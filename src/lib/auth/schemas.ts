import { z } from "zod";

import { sanitizeText } from "@/lib/follow-ups/schemas";
import { MAX_PASSWORD_LENGTH } from "./constants";

export const loginSchema = z.object({
  // Nettoyage puis mise en minuscules dans la même transformation : c'est cette
  // forme normalisée qui sert à la fois de clé de recherche et de clé de
  // comptage. Sans elle, « A@B.fr », « a@b.fr » et « a@b.fr\u00a0 » seraient
  // trois identités distinctes pour la limitation de débit.
  email: z
    .string()
    .transform((value) => sanitizeText(value).toLowerCase())
    .pipe(
      z
        .string()
        .min(1, "L'adresse email est obligatoire.")
        .max(254)
        .pipe(z.email("Adresse email invalide.")),
    ),
  // Aucune contrainte de robustesse à la connexion : ce serait un oracle sur
  // la politique de mots de passe. Seule une borne haute protège Argon2id.
  password: z.string().min(1, "Le mot de passe est obligatoire.").max(MAX_PASSWORD_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface LoginState {
  status: "idle" | "error";
  message?: string;
}

export const initialLoginState: LoginState = { status: "idle" };
