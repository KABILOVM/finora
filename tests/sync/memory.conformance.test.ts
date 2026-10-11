// @vitest-environment node
import { createMemoryServer } from '@/sync/memoryServer';
import { runConformance } from './conformance';

/** Сервер в памяти обязан пройти тот же набор сценариев, что и настоящая схема на PGlite. */
runConformance('MemoryServer', async () => {
  const server = createMemoryServer();
  return {
    transportFor: (userId) => server.transportFor(userId),
    now: () => server.now(),
    signedOutTransport: () => server.signedOutTransport(),
    // adminRows не задаём: у сервера в памяти «обхода проверок доступа» нет; user_id проверяем через dump в memory.test.ts
  };
});
