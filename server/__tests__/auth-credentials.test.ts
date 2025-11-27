import { describe, it, expect, beforeAll } from '@jest/globals';
import { hashPassword } from 'chittyauth';
import { validateCredentials } from '../auth';
import { storage } from '../storage';
import { UserRole } from '@shared/schema';

const TEST_USERNAME = 'login-test-user';
const TEST_PASSWORD = 'super-secret-password';

beforeAll(async () => {
  const hashedPassword = await hashPassword(TEST_PASSWORD);
  const existing = await storage.getUserByUsername(TEST_USERNAME);

  if (existing) {
    await storage.updateUser(existing.id, {
      password: hashedPassword,
    });
  } else {
    await storage.createUser({
      username: TEST_USERNAME,
      password: hashedPassword,
      role: UserRole.MANAGER,
      fullName: 'Login Test User',
      email: 'login-test@example.com',
    });
  }
});

describe('validateCredentials', () => {
  it('authenticates valid username and password', async () => {
    const user = await validateCredentials(TEST_USERNAME, TEST_PASSWORD);

    expect(user.username).toBe(TEST_USERNAME);
    expect(Object.prototype.hasOwnProperty.call(user, 'password')).toBe(false);
  });

  it('rejects invalid usernames or passwords', async () => {
    await expect(validateCredentials(TEST_USERNAME, 'wrong-password')).rejects.toThrow('Invalid credentials');
    await expect(validateCredentials('unknown-user', TEST_PASSWORD)).rejects.toThrow('Invalid credentials');
  });
});
