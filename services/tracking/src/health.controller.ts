import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { kafka } from './kafka';

type Status = 'ok' | 'down';

async function check(fn: () => Promise<unknown>): Promise<Status> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkKafka() {
  // No retries: health must answer fast, not wait out kafkajs' default backoff.
  const admin = kafka.admin({ retry: { retries: 0 } });
  await admin.connect();
  try {
    await admin.listTopics();
  } finally {
    await admin.disconnect();
  }
}

@Controller('health')
export class HealthController {
  @Get()
  async health() {
    const [dbStatus, kafkaStatus] = await Promise.all([check(() => db.execute(sql`select 1`)), check(checkKafka)]);
    const body = { db: dbStatus, kafka: kafkaStatus };
    if (dbStatus !== 'ok' || kafkaStatus !== 'ok') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
