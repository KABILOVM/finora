/*
 * Finora: показ push-напоминаний. Этот файл подключается к сервис-воркеру через importScripts (см. vite.config.ts) и работает
 * внутри него. Без зависимостей, обычный JavaScript (ES5): никаких стрелок, let/const и async.
 *
 * Сообщение приходит снаружи (его шлёт сервер), поэтому ему не доверяем: разбираем безопасно, режем длину, а ссылку по нажатию
 * пускаем только внутреннюю. Уведомление показываем ВСЕГДА, даже если сообщение пустое или испорчено: браузеры (Chrome, Safari
 * на iPhone) требуют, чтобы каждое push-сообщение заканчивалось видимым уведомлением, иначе подписку могут отключить.
 *
 * Правила допустимого пути повторены в src/push/navigate.ts (тест сверяет оба).
 */
(function () {
  'use strict';

  var FALLBACK_TITLE = 'Finora: есть напоминание';
  var DEFAULT_TITLE = 'Finora';
  var DEFAULT_TAG = 'finora-reminder';
  var MAX_TITLE = 100;
  var MAX_BODY = 300;
  var MAX_TAG = 64;
  var MAX_PATH = 300;
  var MAX_RAW = 8000;
  var MSG_NAVIGATE = 'finora-navigate';
  var MSG_SUBSCRIPTION_CHANGED = 'finora-push-subscription-changed';

  /** Строка без управляющих символов (кроме переноса строки в тексте), обрезанная до max (без разрыва суррогатной пары). */
  function clean(value, max, keepNewlines) {
    if (typeof value !== 'string') return '';
    var s = keepNewlines
      ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
      : value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    s = s.replace(/^\s+|\s+$/g, '');
    if (s.length > max) {
      s = s.slice(0, max - 1);
      var last = s.charCodeAt(s.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
      s = s.replace(/\s+$/, '') + '…';
    }
    return s;
  }

  /** Допустимый внутренний путь: «/…» без «//», без «:», «\», «#», пробелов, переводов строк и не-ASCII. Иначе '/'. */
  function safePath(raw) {
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > MAX_PATH) return '/';
    if (!/^\/(?!\/)[A-Za-z0-9\-._~%@!$&'()*+,;=\/?]*$/.test(raw)) return '/';
    return raw;
  }

  /** Разбирает содержимое push-сообщения. Никогда не бросает ошибок; всегда возвращает годное уведомление. */
  function readPayload(event) {
    var note = { title: FALLBACK_TITLE, body: '', tag: DEFAULT_TAG, url: '/' };
    try {
      var data = event && event.data;
      if (!data) return note;
      var text = data.text();
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_RAW) return note;
      var parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return note;
      var title = clean(parsed.title, MAX_TITLE, false);
      var body = clean(parsed.body, MAX_BODY, true);
      if (title === '' && body === '') return note;
      note.title = title === '' ? DEFAULT_TITLE : title;
      note.body = body;
      var tag = clean(parsed.tag, MAX_TAG, false);
      if (tag !== '') note.tag = tag;
      note.url = safePath(parsed.url);
    } catch (e) {
      /* не JSON или странный формат — остаётся запасной текст */
    }
    return note;
  }

  function scopeUrl() {
    var scope = self.registration && typeof self.registration.scope === 'string' ? self.registration.scope : '';
    if (scope === '' && self.location && typeof self.location.href === 'string') {
      scope = self.location.href.replace(/[^\/]*$/, '');
    }
    return scope;
  }

  /** Полный адрес для открытия: адрес приложения + «#» + внутренний путь (приложение работает на хэш-маршрутах). */
  function targetUrl(path) {
    return scopeUrl() + '#' + safePath(path);
  }

  function waitUntil(event, promise) {
    try {
      event.waitUntil(promise);
    } catch (e) {
      /* событие создано вручную (в проверках) — ждать нечем, работа всё равно идёт */
    }
  }

  function isOurWindow(client) {
    var scope = scopeUrl();
    return !!client && typeof client.url === 'string' && scope !== '' && client.url.indexOf(scope) === 0;
  }

  self.addEventListener('push', function (event) {
    var note = readPayload(event);
    var options = {
      body: note.body,
      tag: note.tag,
      icon: 'pwa-192.png',
      badge: 'pwa-192.png',
      lang: 'ru',
      data: { url: note.url }
    };
    var shown;
    try {
      shown = self.registration.showNotification(note.title, options);
    } catch (e) {
      shown = Promise.reject(e);
    }
    // Если с параметрами не вышло — показываем хотя бы голый заголовок: уведомление обязано появиться.
    waitUntil(
      event,
      Promise.resolve(shown).catch(function () {
        return self.registration.showNotification(FALLBACK_TITLE);
      })
    );
  });

  self.addEventListener('notificationclick', function (event) {
    var notification = event.notification;
    try {
      notification.close();
    } catch (e) {
      /* уже закрыто */
    }
    var path = safePath(notification && notification.data && notification.data.url);
    var target = targetUrl(path);

    var work = Promise.resolve()
      .then(function () {
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .catch(function () {
        return [];
      })
      .then(function (list) {
        var own = [];
        for (var i = 0; i < list.length; i++) if (isOurWindow(list[i])) own.push(list[i]);
        if (own.length === 0) return self.clients.openWindow(target);
        // Предпочитаем окно, на которое человек смотрит сейчас.
        var client = own[0];
        for (var j = 0; j < own.length; j++) {
          if (own[j].focused) {
            client = own[j];
            break;
          }
          if (own[j].visibilityState === 'visible') client = own[j];
        }
        return Promise.resolve()
          .then(function () {
            return client.navigate(target);
          })
          .then(
            function (result) {
              // null — воркер не управляет этим окном и перейти не смог: просим само приложение перейти.
              if (result === null || result === undefined) client.postMessage({ type: MSG_NAVIGATE, path: path });
            },
            function () {
              client.postMessage({ type: MSG_NAVIGATE, path: path });
            }
          )
          .then(function () {
            return Promise.resolve()
              .then(function () {
                return client.focus();
              })
              .catch(function () {
                /* окно нельзя вывести вперёд — переход уже сделан */
              });
          });
      })
      .catch(function () {
        /* окно не открыть (например, нет жеста нажатия) — больше ничего сделать нельзя */
      });
    waitUntil(event, work);
  });

  // Браузер сам сменил или сбросил подписку: сообщаем открытым окнам (подписываться самим отсюда нельзя — нужны ключи
  // и вход в аккаунт, они есть только у приложения; оно сверит подписку с сервером).
  self.addEventListener('pushsubscriptionchange', function (event) {
    var work = self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (isOurWindow(list[i])) list[i].postMessage({ type: MSG_SUBSCRIPTION_CHANGED });
        }
      })
      .catch(function () {
        /* окон нет — сверка случится при следующем открытии приложения */
      });
    waitUntil(event, work);
  });
})();
