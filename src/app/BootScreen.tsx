import { Spinner } from '@/components/Button';
import { Logo } from '@/components/Logo';

/** Короткая заставка, пока выясняем, кто вошёл (не дольше нескольких секунд, даже без сети). */
export function BootScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <Logo size={56} />
      <div role="status" aria-label="Загрузка" className="flex items-center gap-2 text-muted">
        <Spinner size={20} />
        <span>Загрузка…</span>
      </div>
    </main>
  );
}
