import * as bcrypt from 'bcrypt';

describe('bcrypt 6 compatibility', () => {
  it('creates and verifies the cost-10 hash used by local signup', async () => {
    const password = 'new-user-password';
    const hash = await bcrypt.hash(password, 10);

    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    await expect(bcrypt.compare(password, hash)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong-password', hash)).resolves.toBe(false);
  });

  it('verifies a hash created before the bcrypt 6 upgrade', async () => {
    const bcrypt5Hash = '$2b$10$Sv6kaV6YYxRSDYeYYHxMLOBpmTeEa4WKKrGyviVKIQPlpFAi3hqc2';

    await expect(bcrypt.compare('legacy-password', bcrypt5Hash)).resolves.toBe(true);
  });
});
