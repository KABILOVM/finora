import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Шиты «Новая операция» и «Правка операции» открываются переходом по адресу (/add, /edit/<id>). Если «+» или строку
 * коснулись дважды, пока шит грузился, в истории две записи с одним адресом. «Назад» после сохранения попадает на вторую,
 * и шит остаётся открытым с уже сохранённой формой. Шит уже на экране, а мы вернулись (POP) на другую запись того же
 * адреса, — это такой дубль: закрываем ещё раз. Новый переход вперёд (PUSH) не трогаем.
 */
export function useCloseDuplicateEntry(onClose: () => void): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const seenKey = useRef(location.key);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (location.key === seenKey.current) return;
    seenKey.current = location.key;
    if (navigationType === 'POP') onCloseRef.current();
  }, [location.key, navigationType]);
}
