import { Kafka, logLevel } from 'kafkajs';
import { env } from './env';

export const kafka = new Kafka({ clientId: 'tracking', brokers: env.KAFKA_BROKERS, logLevel: logLevel.WARN, requestTimeout: 2000 });
