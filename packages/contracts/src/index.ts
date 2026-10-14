import { z } from 'zod';

// Envelope carried by every Kafka message (CLAUDE.md "Events"). Per-type payload schemas come with their features.
export const envelopeSchema = z.object({
  event_id: z.uuid(),
  type: z.string().min(1),
  schema_version: z.number().int().positive(),
  occurred_at: z.iso.datetime(),
  user_id: z.uuid(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;
