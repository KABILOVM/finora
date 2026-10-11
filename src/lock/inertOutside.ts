/**
 * Пока замок закрыт, всё остальное на странице должно быть недоступно: ни фокуса, ни чтения скринридером.
 * Приложение внутри корня закрывает сам LockGate (inert + aria-hidden на обёртке детей). Эта функция закрывает то,
 * что лежит в <body> СНАРУЖИ корня: окна (шиты), которые рисуются порталом, в том числе появившиеся уже под закрытым замком.
 * Возвращает функцию, которая возвращает всё как было.
 */
export function inertOutside(keep: HTMLElement): () => void {
  const touched = new Map<Element, { inert: string | null; ariaHidden: string | null }>();

  const apply = (el: Element) => {
    if (el === keep || el.contains(keep) || touched.has(el)) return;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return;
    touched.set(el, { inert: el.getAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden') });
    el.setAttribute('inert', '');
    el.setAttribute('aria-hidden', 'true');
  };

  for (const el of Array.from(document.body.children)) apply(el);

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) apply(n);
      });
    }
  });
  observer.observe(document.body, { childList: true });

  return () => {
    observer.disconnect();
    for (const [el, was] of touched) {
      if (was.inert === null) el.removeAttribute('inert');
      else el.setAttribute('inert', was.inert);
      if (was.ariaHidden === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', was.ariaHidden);
    }
    touched.clear();
  };
}
