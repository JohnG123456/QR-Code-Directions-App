// The shape of a draft pushed up from a browser to the account.
//
// Kept out of the Route Handler so it can be exercised directly - the
// route checks authentication first, so a bad payload and a missing
// session are indistinguishable from outside, and a validation rule that
// rejects every real draft would sail through an end-to-end test.

import { z } from "zod";

// Comfortably above a rendered plan sheet, comfortably below Vercel's
// request body limit.
const MAX_IMAGE_CHARS = 8_000_000;

export const draftPayloadSchema = z.object({
  fileName: z.string().nullable(),
  step: z.string().min(1),
  imageDataUrl: z.string().startsWith("data:image/").max(MAX_IMAGE_CHARS),
  // Not .int(): a PDF viewport's dimensions are the page size times a
  // scale factor, so they come out fractional (1555.74, not 1556), and
  // drafts saved in a browser carry those exact values. Requiring whole
  // numbers rejected every real draft. The database column is an integer,
  // so these are rounded on the way in.
  imageWidth: z.number().positive(),
  imageHeight: z.number().positive(),
  labels: z.array(
    z.object({ id: z.string(), text: z.string(), x: z.number(), y: z.number() })
  ),
  pairs: z.array(
    z.object({
      plan: z.object({ x: z.number(), y: z.number() }),
      world: z.object({ x: z.number(), y: z.number() }),
    })
  ),
  lastImportedAt: z.number().nullable().optional(),
});

export type DraftPayload = z.infer<typeof draftPayloadSchema>;
