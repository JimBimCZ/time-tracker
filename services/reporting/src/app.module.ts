import { Module, OnApplicationShutdown } from '@nestjs/common';
import { pool } from './db';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await pool.end();
  }
}
