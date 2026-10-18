/**
 * ЛОМАТЕЛЬ: заголовки хостинга и замок. Замок держится на WebAuthn (navigator.credentials.get). Заголовок Permissions-Policy
 * из vercel.json решает, можно ли странице вообще вызывать WebAuthn. Пустой список `()` запрещает это даже самой странице:
 * в продакшене замок не включится (раздел честно скажет «Замок отключён настройками сайта»), то есть фича мертва.
 * Так же и с микрофоном: `microphone=()` убивает «Продиктовать» (покупки) и «Продиктовать расходы» в Chrome и Edge.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Rule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

function permissionsPolicy(): Map<string, string> {
  const json = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { headers: Rule[] };
  let value = '';
  for (const rule of json.headers) {
    if (rule.source !== '/(.*)') continue;
    for (const h of rule.headers) if (h.key.toLowerCase() === 'permissions-policy') value = h.value;
  }
  const out = new Map<string, string>();
  for (const part of value.split(',')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.*?)\s*$/.exec(part);
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

describe('ATTACK: Permissions-Policy в vercel.json против замка по Face ID', () => {
  it('publickey-credentials-get не запрещён для самой страницы (иначе замок в продакшене создастся, но не откроется ни разу)', () => {
    const policy = permissionsPolicy();
    expect(policy.size, 'заголовок Permissions-Policy на месте').toBeGreaterThan(0);
    const get = policy.get('publickey-credentials-get');
    // допустимо: директивы нет совсем (по умолчанию «self») или явно разрешено (self)
    expect(get === undefined || /\bself\b/.test(get), `publickey-credentials-get=${get} запрещает WebAuthn даже самой странице`).toBe(true);
  });

  it('publickey-credentials-create тоже не запрещён (иначе замок не включить)', () => {
    const create = permissionsPolicy().get('publickey-credentials-create');
    expect(create === undefined || /\bself\b/.test(create), `publickey-credentials-create=${create}`).toBe(true);
  });
});

describe('ATTACK: Permissions-Policy в vercel.json против голосового ввода', () => {
  it('microphone разрешён самой странице и только ей (иначе «Продиктовать» в продакшене не включит запись в Chrome и Edge)', () => {
    const mic = permissionsPolicy().get('microphone');
    // допустимо: директивы нет совсем (по умолчанию «self») или (self) без чужих источников и без «*»
    expect(mic === undefined || (/\bself\b/.test(mic) && !/\*|https?:/.test(mic)), `microphone=${mic}`).toBe(true);
  });

  it('камера по-прежнему запрещена (приложению она не нужна)', () => {
    expect(permissionsPolicy().get('camera')).toBe('()');
  });
});
