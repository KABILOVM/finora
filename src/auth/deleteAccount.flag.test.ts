import { describe, expect, it } from 'vitest';
import { ACCOUNT_DELETION_ENABLED } from './deleteAccount';

describe('удаление аккаунта', () => {
  it('выключено, пока проект Supabase общий с другим приложением (см. комментарий к флагу)', () => {
    expect(ACCOUNT_DELETION_ENABLED).toBe(false);
  });
});
