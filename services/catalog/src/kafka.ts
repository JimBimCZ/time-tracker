import { Kafka, logLevel } from 'kafkajs';
import { env } from './env';

export const kafka = new Kafka({ clientId: 'catalog', brokers: env.KAFKA_BROKERS, logLevel: logLevel.WARN });
