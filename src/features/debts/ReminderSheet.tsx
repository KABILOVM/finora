import { useState } from 'react';
import { buttonClasses, Button } from '@/components/Button';
import { TextArea } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { copyText } from '@/features/settings/copyText';
import { canNativeShare, nativeShare, telegramUrl, whatsappUrl } from './reminderShare';

const TEXT_MAX = 1000;

/** Ссылка на мессенджер в новой вкладке. Пустой текст отправлять нечего: тогда вместо ссылки недоступная кнопка. */
function MessengerLink({ name, href, disabled, primary }: { name: string; href: string; disabled: boolean; primary: boolean }) {
  if (disabled) {
    return (
      <Button variant={primary ? 'primary' : 'secondary'} disabled>
        {name}
      </Button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClasses(primary ? 'primary' : 'secondary', 'md')}>
      {name}
    </a>
  );
}

export interface ReminderSheetProps {
  name: string;
  /** Готовый текст: человек может его поправить. */
  text: string;
  onClose: () => void;
}

/**
 * Напоминание о долге: текст можно поправить, затем отправить через «Поделиться», Telegram или WhatsApp либо скопировать.
 * Приложение ничего не отправляет само — сумма уходит из него только после нажатия на одну из этих кнопок.
 */
export function ReminderSheet({ name, text, onClose }: ReminderSheetProps) {
  const toast = useToast();
  const [value, setValue] = useState(text);
  const body = value.trim();
  const empty = body === '';
  const share = canNativeShare();

  const doShare = async () => {
    const r = await nativeShare(body);
    if (r === 'failed') toast.error('Не удалось открыть «Поделиться». Скопируйте текст и отправьте сами.');
    else if (r === 'shared') onClose();
  };
  const copy = async () => {
    if (await copyText(body)) toast.success('Текст скопирован');
    else toast.error('Не удалось скопировать. Выделите текст и скопируйте вручную.');
  };

  return (
    <Sheet open onClose={onClose} title={`Напомнить: ${name}`}>
      <div className="flex flex-col gap-4">
        <TextArea
          label="Текст напоминания"
          hint="Можно поправить. Приложение ничего не отправляет само: текст уйдёт, только когда вы выберете, куда."
          value={value}
          maxLength={TEXT_MAX}
          rows={4}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex flex-col gap-2">
          {share && (
            <Button size="lg" disabled={empty} onClick={() => void doShare()}>
              Поделиться…
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <MessengerLink name="Telegram" href={telegramUrl(body)} disabled={empty} primary={!share} />
            <MessengerLink name="WhatsApp" href={whatsappUrl(body)} disabled={empty} primary={!share} />
          </div>
          <Button variant="secondary" disabled={empty} onClick={() => void copy()}>
            Скопировать текст
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
