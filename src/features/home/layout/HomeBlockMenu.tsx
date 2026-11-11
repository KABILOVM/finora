import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { runWithoutModalAnchor } from '@/components/modalHistory';
import { Sheet } from '@/components/Sheet';
import type { HomeBlock } from './blocks';

export interface HomeBlockMenuProps {
  /** Блок, на котором держали палец; null — меню закрыто. */
  block: HomeBlock | null;
  onClose: () => void;
  /** Убрать блок с главной. */
  onHide: (block: HomeBlock) => void;
  /** Открыть выбор валют (только у блока курсов). */
  onCurrencies: () => void;
}

/**
 * Меню блока на «Главной» — по долгому нажатию на блок: убрать его с главной, не заходя в настройку, или открыть настройку
 * главной целиком. У блока курсов — ещё и выбор валют. Что блок показывает, написано под заголовком: человек видит, что именно
 * он скрывает.
 */
export function HomeBlockMenu({ block, onClose, onHide, onCurrencies }: HomeBlockMenuProps) {
  const navigate = useNavigate();
  return (
    <Sheet open={block !== null} onClose={onClose} title={block?.title ?? ''}>
      {block && (
        <>
          <p className="mb-3 text-muted">{block.hint}</p>
          <div className="flex flex-col gap-2" data-testid="home-block-menu">
            {block.id === 'rates' && (
              <Button variant="secondary" size="lg" fullWidth onClick={onCurrencies}>
                Выбрать валюты
              </Button>
            )}
            <Button variant="secondary" size="lg" fullWidth onClick={() => onHide(block)}>
              Скрыть с главной
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              // окно держит запись в истории под «Назад»: переход делаем так, чтобы она не встала поперёк (modalHistory.ts)
              onClick={() => {
                runWithoutModalAnchor(() => navigate('/?edit=1', { state: { homeEdit: true } }));
                onClose();
              }}
            >
              Настроить главную
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
