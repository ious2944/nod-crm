/**
 * Colonnes d'un export de contacts Outlook — fonctions pures.
 *
 * Référence : les 61 en-têtes anglais du nouvel Outlook
 * (`tests/fixtures/outlook/contacts-outlook-fixture.csv`), plus les libellés
 * français de l'Outlook classique. Chaque colonne a un sort explicite :
 *
 * - `import` : alimente un champ du contact (nom, e-mail, téléphone…) ;
 * - `notes`  : n'a pas de champ dédié, on l'ajoute aux notes avec un libellé ;
 * - `ignore` : volontairement écartée — phonétique japonaise, moyens de
 *   communication obsolètes, ou données personnelles non nécessaires à un CRM
 *   (minimisation RGPD : conjoint, études, loisirs, anniversaire de mariage,
 *   adresse personnelle).
 *
 * La reconnaissance des en-têtes est insensible à la casse, aux accents et aux
 * espaces : « E-mail Address », « e-mail address » et « E-mailAddress » sont
 * la même colonne.
 */

export type ColumnFate = "import" | "notes" | "ignore";

export interface OutlookColumn {
  key: string;
  /** En-tête exact du nouvel Outlook (anglais). */
  english: string;
  /** Libellés de l'Outlook classique en français. */
  french: readonly string[];
  fate: ColumnFate;
  /** Libellé utilisé dans les notes et dans l'aperçu. */
  label: string;
}

const col = (
  key: string,
  english: string,
  french: readonly string[],
  fate: ColumnFate,
  label: string,
): OutlookColumn => ({ key, english, french, fate, label });

/** Les 61 colonnes, dans l'ordre de l'export. */
export const OUTLOOK_COLUMNS = [
  col("firstName", "First Name", ["Prénom"], "import", "Prénom"),
  col("middleName", "Middle Name", ["Deuxième prénom", "Second prénom"], "import", "Deuxième prénom"),
  col("lastName", "Last Name", ["Nom"], "import", "Nom"),
  col("title", "Title", ["Titre", "Civilité"], "notes", "Civilité"),
  col("suffix", "Suffix", ["Suffixe"], "notes", "Suffixe"),
  col("nickname", "Nickname", ["Surnom"], "notes", "Surnom"),
  col("givenYomi", "Given Yomi", ["Prénom Yomi", "Prénom (Yomi)"], "ignore", "Prénom Yomi"),
  col("surnameYomi", "Surname Yomi", ["Nom Yomi", "Nom (Yomi)"], "ignore", "Nom Yomi"),
  col("email1", "E-mail Address", ["Adresse de messagerie", "Adresse e-mail"], "import", "E-mail"),
  col("email2", "E-mail 2 Address", ["Adresse de messagerie 2", "Adresse e-mail 2"], "notes", "E-mail 2"),
  col("email3", "E-mail 3 Address", ["Adresse de messagerie 3", "Adresse e-mail 3"], "notes", "E-mail 3"),
  col("homePhone", "Home Phone", ["Téléphone (domicile)", "Téléphone domicile"], "import", "Tél. domicile"),
  col("homePhone2", "Home Phone 2", ["Téléphone 2 (domicile)", "Téléphone domicile 2"], "import", "Tél. domicile 2"),
  col("businessPhone", "Business Phone", ["Téléphone (bureau)", "Téléphone bureau"], "import", "Tél. bureau"),
  col("businessPhone2", "Business Phone 2", ["Téléphone 2 (bureau)", "Téléphone bureau 2"], "import", "Tél. bureau 2"),
  col("mobilePhone", "Mobile Phone", ["Tél. mobile", "Téléphone mobile", "Mobile"], "import", "Tél. mobile"),
  col("carPhone", "Car Phone", ["Téléphone (voiture)", "Téléphone voiture"], "notes", "Tél. voiture"),
  col("otherPhone", "Other Phone", ["Téléphone (autre)", "Autre téléphone"], "import", "Autre tél."),
  col("primaryPhone", "Primary Phone", ["Téléphone principal"], "import", "Tél. principal"),
  col("pager", "Pager", ["Récepteur de radiomessagerie", "Bip"], "ignore", "Pager"),
  col("businessFax", "Business Fax", ["Télécopie (bureau)", "Fax (bureau)"], "notes", "Fax bureau"),
  col("homeFax", "Home Fax", ["Télécopie (domicile)", "Fax (domicile)"], "notes", "Fax domicile"),
  col("otherFax", "Other Fax", ["Télécopie (autre)", "Fax (autre)"], "notes", "Autre fax"),
  col("companyMainPhone", "Company Main Phone", ["Téléphone société", "Téléphone de la société"], "import", "Tél. société"),
  col("callback", "Callback", ["Rappel"], "ignore", "Rappel"),
  col("radioPhone", "Radio Phone", ["Radio téléphone", "Radiotéléphone"], "ignore", "Radio"),
  col("telex", "Telex", ["Télex"], "ignore", "Télex"),
  col("ttyPhone", "TTY/TDD Phone", ["Téléphone TDD/TTY", "Téléphone TTY/TDD"], "ignore", "TTY/TDD"),
  col("imAddress", "IMAddress", ["Adresse de messagerie instantanée", "Adresse MI"], "notes", "Messagerie instantanée"),
  col("jobTitle", "Job Title", ["Fonction", "Poste"], "import", "Fonction"),
  col("department", "Department", ["Service"], "notes", "Service"),
  col("company", "Company", ["Société", "Entreprise"], "import", "Entreprise"),
  col("officeLocation", "Office Location", ["Bureau"], "notes", "Bureau"),
  col("managerName", "Manager's Name", ["Nom du responsable", "Nom du manager"], "notes", "Responsable"),
  col("assistantName", "Assistant's Name", ["Nom de l'assistant(e)", "Nom de l'assistant"], "notes", "Assistant(e)"),
  col("assistantPhone", "Assistant's Phone", ["Téléphone de l'assistant(e)", "Téléphone de l'assistant"], "notes", "Tél. assistant(e)"),
  col("companyYomi", "Company Yomi", ["Société Yomi", "Société (Yomi)"], "ignore", "Société Yomi"),
  col("businessStreet", "Business Street", ["Rue (bureau)"], "notes", "Rue (bureau)"),
  col("businessCity", "Business City", ["Ville (bureau)"], "notes", "Ville (bureau)"),
  col("businessState", "Business State", ["Dép/Région (bureau)", "Département (bureau)"], "notes", "Région (bureau)"),
  col("businessPostalCode", "Business Postal Code", ["Code postal (bureau)"], "notes", "Code postal (bureau)"),
  col("businessCountry", "Business Country/Region", ["Pays/Région (bureau)", "Pays (bureau)"], "notes", "Pays (bureau)"),
  col("homeStreet", "Home Street", ["Rue (domicile)"], "ignore", "Rue (domicile)"),
  col("homeCity", "Home City", ["Ville (domicile)"], "ignore", "Ville (domicile)"),
  col("homeState", "Home State", ["Dép/Région (domicile)", "Département (domicile)"], "ignore", "Région (domicile)"),
  col("homePostalCode", "Home Postal Code", ["Code postal (domicile)"], "ignore", "Code postal (domicile)"),
  col("homeCountry", "Home Country/Region", ["Pays/Région (domicile)", "Pays (domicile)"], "ignore", "Pays (domicile)"),
  col("otherStreet", "Other Street", ["Rue (autre)"], "notes", "Rue (autre)"),
  col("otherCity", "Other City", ["Ville (autre)"], "notes", "Ville (autre)"),
  col("otherState", "Other State", ["Dép/Région (autre)", "Département (autre)"], "notes", "Région (autre)"),
  col("otherPostalCode", "Other Postal Code", ["Code postal (autre)"], "notes", "Code postal (autre)"),
  col("otherCountry", "Other Country/Region", ["Pays/Région (autre)", "Pays (autre)"], "notes", "Pays (autre)"),
  col("personalWebPage", "Personal Web Page", ["Page Web personnelle"], "notes", "Site personnel"),
  col("spouse", "Spouse", ["Conjoint(e)", "Conjoint"], "ignore", "Conjoint"),
  col("schools", "Schools", ["Écoles", "Établissements scolaires"], "ignore", "Écoles"),
  col("hobby", "Hobby", ["Loisirs", "Passe-temps"], "ignore", "Loisirs"),
  col("location", "Location", ["Emplacement", "Lieu"], "notes", "Lieu"),
  col("webPage", "Web Page", ["Page Web"], "notes", "Site web"),
  col("birthday", "Birthday", ["Anniversaire", "Date de naissance"], "notes", "Date de naissance"),
  col("anniversary", "Anniversary", ["Anniversaire de mariage ou fête", "Anniversaire de mariage"], "ignore", "Anniversaire de mariage"),
  col("notes", "Notes", ["Notes", "Remarques"], "import", "Notes"),
] as const satisfies readonly OutlookColumn[];

export type OutlookColumnKey = (typeof OUTLOOK_COLUMNS)[number]["key"];

/** Ordre de préférence pour le téléphone principal ; les autres vont en notes. */
export const PRINCIPAL_PHONE_ORDER = [
  "primaryPhone",
  "mobilePhone",
  "businessPhone",
  "businessPhone2",
  "companyMainPhone",
  "homePhone",
  "homePhone2",
  "otherPhone",
] as const satisfies readonly OutlookColumnKey[];

/** Ordre de préférence pour l'e-mail principal. */
export const PRINCIPAL_EMAIL_ORDER = ["email1", "email2", "email3"] as const satisfies readonly OutlookColumnKey[];

/** Casse, accents et espaces neutralisés. */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, "");
}

const BY_ENGLISH = new Map<string, OutlookColumn>(
  OUTLOOK_COLUMNS.map((column) => [normalizeHeader(column.english), column]),
);
const BY_FRENCH = new Map<string, OutlookColumn>();
for (const column of OUTLOOK_COLUMNS) {
  for (const alias of column.french) {
    const key = normalizeHeader(alias);
    // « Notes » est identique dans les deux langues : l'anglais reste la référence.
    if (!BY_ENGLISH.has(key) && !BY_FRENCH.has(key)) BY_FRENCH.set(key, column);
  }
}

export interface HeaderMapping {
  /** Index de colonne du fichier pour chaque clé reconnue (première occurrence). */
  indexes: Partial<Record<OutlookColumnKey, number>>;
  /** En-têtes reconnus, avec leur sort. */
  recognized: { header: string; key: OutlookColumnKey; fate: ColumnFate; label: string }[];
  /** En-têtes inconnus (ou en double) : leur contenu est écarté. */
  unknown: string[];
  /** Langue majoritaire des en-têtes : décide de l'ordre jour/mois des dates. */
  language: "en" | "fr";
}

export function mapOutlookHeader(header: readonly string[]): HeaderMapping {
  const indexes: Partial<Record<OutlookColumnKey, number>> = {};
  const recognized: HeaderMapping["recognized"] = [];
  const unknown: string[] = [];
  let english = 0;
  let french = 0;

  header.forEach((raw, index) => {
    const name = normalizeHeader(raw);
    if (!name) return;
    const fromEnglish = BY_ENGLISH.get(name);
    const column = fromEnglish ?? BY_FRENCH.get(name);
    if (!column || indexes[column.key] !== undefined) {
      unknown.push(raw.trim());
      return;
    }
    if (fromEnglish) {
      // « Notes » ne dit rien de la langue.
      if (column.key !== "notes") english += 1;
    } else {
      french += 1;
    }
    indexes[column.key] = index;
    recognized.push({ header: raw.trim(), key: column.key, fate: column.fate, label: column.label });
  });

  return { indexes, recognized, unknown, language: french > english ? "fr" : "en" };
}

export function columnLabel(key: OutlookColumnKey): string {
  return OUTLOOK_COLUMNS.find((column) => column.key === key)!.label;
}
