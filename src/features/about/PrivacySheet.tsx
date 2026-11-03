import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { getContact, type Contact } from './contact';
import { NO_CONTACT_TEXT, POLICY_DATE, PRIVACY_BLOCKS, TERMS_BLOCKS, type PolicyBlock } from './privacyText';

export interface PrivacySheetProps {
  onClose: () => void;
  /** Контакт владельца; по умолчанию из сборки (VITE_CONTACT). null — контакта нет. */
  contact?: Contact | null;
}

/** «3 ноября 2026»: у даты редакции год пишем всегда (longDate в текущем году его опускает). */
const editionDate = (iso: string): string =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

function Block({ block }: { block: PolicyBlock }) {
  return (
    <section aria-labelledby={`policy-${block.id}`}>
      <h3 id={`policy-${block.id}`} className="mb-2 text-base font-bold">
        {block.title}
      </h3>
      {block.paragraphs?.map((p) => (
        <p key={p} className="mb-2 text-base text-text last:mb-0">
          {p}
        </p>
      ))}
      {block.items && (
        <ul className="flex flex-col gap-2.5">
          {block.items.map((it) => (
            <li key={it.lead} className="text-base">
              <span className="font-semibold">{it.lead}</span> <span className="text-muted">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Окно «Конфиденциальность и условия»: что хранится и что уходит другим сервисам, как забрать или удалить данные, короткие условия
 * и контакт владельца. Открывается и до входа (с экрана входа), и из «Настроек»; роутера не требует.
 */
export function PrivacySheet({ onClose, contact = getContact() }: PrivacySheetProps) {
  return (
    <Sheet
      open
      onClose={onClose}
      title="Конфиденциальность и условия"
      footer={
        <Button size="lg" fullWidth data-autofocus onClick={onClose}>
          Понятно
        </Button>
      }
    >
      <div className="flex flex-col gap-6" data-testid="privacy-text">
        {PRIVACY_BLOCKS.map((b) => (
          <Block key={b.id} block={b} />
        ))}
        {TERMS_BLOCKS.map((b) => (
          <Block key={b.id} block={b} />
        ))}
        <section aria-labelledby="policy-contact">
          <h3 id="policy-contact" className="mb-2 text-base font-bold">
            Связаться
          </h3>
          {contact ? (
            <p className="text-base">
              <a
                href={contact.href}
                {...(contact.href.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="font-semibold text-brand underline underline-offset-2"
              >
                {contact.label}
              </a>
            </p>
          ) : (
            <p className="text-base text-muted">{NO_CONTACT_TEXT}</p>
          )}
        </section>
        <p className="text-center text-xs text-muted">Редакция от {editionDate(POLICY_DATE)}</p>
      </div>
    </Sheet>
  );
}
