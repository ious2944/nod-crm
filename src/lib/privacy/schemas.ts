import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).transform((v) => v || undefined);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalDate = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.date().optional(),
);
const requiredDate = z.coerce.date();

export const privacyIdSchema = z.string().uuid();

export const treatmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredText(160),
  purpose: requiredText(1200),
  description: text(4000),
  owner: text(200),
  dataSubjects: text(2000),
  dataCategories: text(2000),
  legalBasis: z.enum([
    "CONSENT",
    "CONTRACT",
    "LEGAL_OBLIGATION",
    "LEGITIMATE_INTEREST",
    "PUBLIC_TASK",
    "VITAL_INTERESTS",
    "TO_DETERMINE",
  ]),
  retentionPeriod: text(1000),
  recipients: text(2000),
  transferOutsideEea: z.enum(["YES", "NO", "UNKNOWN"]),
  securityMeasures: text(4000),
  lastReviewedAt: optionalDate,
  nextReviewAt: optionalDate,
  status: z.enum(["ACTIVE", "REVIEW", "ARCHIVED"]),
});

export const processorSchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredText(160),
  service: requiredText(300),
  category: text(300),
  dataCategories: text(2000),
  purpose: text(2000),
  country: text(200),
  eeaStatus: z.enum(["YES", "NO", "UNKNOWN"]),
  dpaStatus: z.enum(["SIGNED", "TO_REVIEW", "MISSING", "NOT_APPLICABLE"]),
  dpaUrl: text(1200),
  subprocessorsStatus: z.enum(["YES", "NO", "UNKNOWN"]),
  notes: text(4000),
  lastReviewedAt: optionalDate,
  nextReviewAt: optionalDate,
});

const requestFields = z.object({
  contactId: z.union([z.literal(""), z.string().uuid()]).optional(),
  requesterName: text(300),
  requesterEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  requestType: z.enum([
    "ACCESS",
    "RECTIFICATION",
    "ERASURE",
    "OBJECTION",
    "RESTRICTION",
    "PORTABILITY",
    "OTHER",
  ]),
  receivedAt: requiredDate,
  dueAt: requiredDate,
  status: z.enum(["RECEIVED", "IN_PROGRESS", "WAITING", "COMPLETED", "REFUSED"]),
  owner: text(200),
  notes: text(4000),
});

function hasRequestIdentity(value: z.infer<typeof requestFields>) {
  return Boolean(value.contactId || value.requesterName || value.requesterEmail);
}

export const requestSchema = requestFields.refine(hasRequestIdentity, {
  message: "Identifie la personne par un contact, un nom ou un email.",
});

export const updateRequestSchema = requestFields
  .extend({ id: privacyIdSchema })
  .refine(hasRequestIdentity, {
    message: "Identifie la personne par un contact, un nom ou un email.",
  });

export const incidentSchema = z.object({
  id: z.string().uuid().optional(),
  title: requiredText(200),
  discoveredAt: requiredDate,
  occurredAt: optionalDate,
  description: requiredText(6000),
  dataCategories: text(3000),
  affectedCount: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().nonnegative().max(1_000_000_000).optional(),
  ),
  consequences: text(4000),
  measures: text(4000),
  riskLevel: z.enum(["TO_ASSESS", "LOW", "MODERATE", "HIGH"]),
  authorityNotification: z.enum(["TO_ASSESS", "NO", "YES"]),
  notifiedAt: optionalDate,
  peopleInformed: z.enum(["TO_ASSESS", "NO", "YES"]),
  owner: text(200),
  status: z.enum(["OPEN", "ANALYSIS", "CLOSED"]),
});
