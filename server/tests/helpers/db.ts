import mongoose from 'mongoose';

export const TEST_MONGODB_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/cgi-test';

/**
 * Connects to the test database, or returns false if none is reachable so that
 * integration suites can skip with an explicit reason instead of failing.
 */
export async function tryConnectTestDb(): Promise<boolean> {
  mongoose.set('sanitizeFilter', true);
  try {
    await mongoose.connect(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 2500 });
    return true;
  } catch {
    return false;
  }
}

export async function resetTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

export async function closeTestDb(): Promise<void> {
  await mongoose.disconnect();
}
