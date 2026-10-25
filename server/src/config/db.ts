import mongoose from 'mongoose';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);
// Reject query operators in filters built from user input (NoSQL injection hardening).
mongoose.set('sanitizeFilter', true);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/** readyState 1 = connected. */
export function dbStatus(): 'connected' | 'connecting' | 'disconnected' {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    default:
      return 'disconnected';
  }
}
