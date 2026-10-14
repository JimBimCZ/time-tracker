import { z } from 'zod';

// Local dev reads ./.env; containers pass real env vars, so a missing file is fine.
try {
  process.loadEnvFile();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

export const env = z
  .object({
    PORT: z.coerce.number().int().positive(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
    KAFKA_BROKERS: z.string().min(1).transform((s) => s.split(',')),
  })
  .parse(process.env);
