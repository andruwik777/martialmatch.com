# План: WebSocket live (Fights) + прокси — актуальная версия

## Цели

- **HTTP (CORS):** как сейчас — Cloudflare Worker, [config.js](../config.js) `BASE_BY_MODE` без изменения логики, только **параллельные** WSS-URL.
- **WebSocket:** мини-сервер **Node + `http` + `ws`**, деплой **Render**; **не** папка `websocket/` в корне, а **рядом с** `worker.js` в **трёх существующих** папках `server/`.
- **Статик:** GitHub Pages; `fights.json` полл (30 с / таб / клик) **без изменения** концепции; live (таймер, очки, статусы) — **поверх** из WSS.
- **Режим фикстур (628, `?mode=test`):** циклическая **предзаписанная** сценарная лента из `server/dev-test-martialmatch-v1/data/...`, согласованная с [fights.json](../server/dev-test-martialmatch-v1/data/628-x-superpuchar-polski-bjj-nogi-gi/fights.json) (три ковра).

## Три среды (как у HTTP-воркеров)

| Среда | Роль | Код | Деплой (типично) |
|--------|------|-----|------------------|
| **prod** | «Боевой» WSS+Worker; **при релизе** состояние/URL **как у test** (тот же паттерн, что для `BASE_BY_MODE` на ветке release) | [server/prod-martialmatch-v1/](../server/prod-martialmatch-v1/) + `wss-proxy.js` | Render prod, URL в [config.js](../config.js) ветка **release** (ключ `prod`) |
| **test** | **Основная разработка** клиента, WSS **ходят на оригинальный** MartialMatch (`wss://martialmatch.com/_wss` через прокси) | [server/dev-martialmatch-v1/](../server/dev-martialmatch-v1/) + `wss-proxy.js` | Render «test/real-upstream» или локально; **если** в [config.js](../config.js) на **master** ключ `test` смотрит **сюда** — это «живой» тестовый WSS |
| **devtest** | **Только** фикстуры и **фейковый** ответ: предзаписанные JSON-строки из [server/dev-test-martialmatch-v1/data](../server/dev-test-martialmatch-v1/data) (в т.ч. [data/websocket/](../server/dev-test-martialmatch-v1/data/websocket)) | [server/dev-test-martialmatch-v1/](../server/dev-test-martialmatch-v1/) + `wss-proxy.js` (режим `PROXY_MODE=devtest` или аналог) | Render **отдельный** сервис; на **master** `WSS_BASE_BY_MODE.test` **часто** указывает **сюда** для `?mode=test` и сценариев 628 **без** боя в MM |

**Важно:** в [config.js](../config.js) по-прежнему **два** ключа, **аналогично** HTTP:

```text
# master (разработка) — тот же паттерн, что сейчас
WSS_BASE_BY_MODE = { prod: dev…, test: dev-test… }   # + реальные wss:// URL Render

# release
WSS_BASE_BY_MODE = { prod: prod…, test: prod-test… }
```

Значения **поменяешь в ветке release** так же, как для `BASE_BY_MODE` (примеры воркеров ты привёл). Третья среда **devtest** — не обязана быть **третьим** ключом в `config` (если не введёте `?mode=devtest`): обычно `test` WSS в master = **devtest-Render** для `mode=test` с фикстурами; «настоящий» MM при отладке прокси — другой URL (локальный / другой env).

## Расположение кода (не `websocket/` в корне)

В каждой из папок:

- [server/dev-martialmatch-v1/worker.js](../server/dev-martialmatch-v1/worker.js) — как сейчас;
- **новый файл** с **своим именем**, напр. `wss-proxy.js` (или `ws-server.js` — **зафиксировать одно**), зеркаля **соседний** `package.json` для Render, если воркеру не нужен Node — **отдельный** `package.json` / деплой только WSS, как сочтёте (аналогия: «отдельный воркер-файл, отдельный wss-файл»).

**Общий код** (чтобы не копипастить трижды): опционально `server/_shared/…` — **на этапе имплементации** решить; план **не** настаивает, главное **три** деплоя из трёх папок, как **три** воркера.

## [config.js](../config.js)

- Добавить **`WSS_BASE_BY_MODE`**: `prod` и `test`, **те же** правила `mode` / `isTestMode`, что и для `baseUrl` (тот же `?mode=test`).
- Экспорт в `MM_CONFIG`: например `wssBaseUrl` (или `wssUrl(): string` если path важен).
- **Ветка master** — dev/dev-test WSS; **release** — prod (как в твоих примерах `BASE_BY_MODE`).

## Поведение прокси (все варианты, кроме devtest)

- Браузер (один WSS) ↔ прокси ↔ `wss://martialmatch.com/_wss`.
- Сообщения: `{"channel":"scoreboard:mat:ID"}`, `{"leaveChannel":true,…}`; fan-out, ref-count, **reconnect upstream** без «минутного» рву клиенту, очистка **close**/**error**.

## devtest: фикстура для ивента 628 (цикл для `?mode=test`)

**Файл(ы):** под [server/dev-test-martialmatch-v1/data/websocket/](../server/dev-test-martialmatch-v1/data/websocket) (или `…/data/wss-fixtures/628/…`), формат: **массив/набор** JSON-строк в **хронологическом** порядке, по кругу.

**Содержательно (сценарий, под три ковра из 628, см. [fights.json](../server/dev-test-martialmatch-v1/data/628-x-superpuchar-polski-bjj-nogi-gi/fights.json) `fightQueueStatuses`):**

1. **Мат A (текущий «активный» / ongoing):** при **подключении** клиент **как бы попал в середину** схватки: `internalTime` уже < полного, `timerClass: timer-started`, `fightStatus: ongoing`, дальше тик таймера.
2. **Мат B (сейчас called / awaiting / до старта):** в начале цикла `fightStatus: awaiting` (и `timerClass` согласно дампу, вроде `timer-before-start`); **через** несколько кадров (сек) → `ongoing`, таймер пошёл; **в период ongoing** — **пауза** на **несколько** секунд (`timer-paused` при `fightStatus` всё ещё `ongoing` при необходимости, как в [new_connection.ws](../server/dev-test-martialmatch-v1/data/websocket/new_connection.ws)), затем **снова** `timer-started`.
3. **Мат C (ближайший scheduled / пока в очереди):** старт **scheduled-like** (HTTP смысл — «ещё в списке»; в WSS, если `fightStatus` только `awaiting`/`ongoing`, **имитировать** начало **ожидания** у ковра через `awaiting` + «до боя» тайминг); **через пару** сек — переход **called**-аналог (в WSS: `awaiting` + до старта, как договорились); **еще** через **несколько** сек — `ongoing` и т.д. **(или** компактный цикл только `awaiting` → `ongoing` без отдельного `scheduled` в JSON — пока `fightStatus` в WSS только два значения, как в MVP.)

Сервер **devtest** **каждую 1 c** (или **каждое сообщение** = кадр) отдаёт **следующую** строку по **кругу** **для тех каналов, на которые подписался** клиент (независимые **указатели** по `channel` или **один** сценарий, если каналы **синхронны** — зафиксировать в имплементации; проще: **per-channel** index).

**Согласованность** с [pl/events/current-matches/current-matches.js](../pl/events/current-matches/current-matches.js) визуалом: `timerClass`, `red/blue` scores, `fightStatus` (awaiting/ongoing).

## Preconnect (раннее соединение WSS)

**Идея:** на **загрузке** страницы (например [pl/events/current-matches/index.html](../pl/events/current-matches/index.html) / общий `config` + [current-matches.js](../pl/events/current-matches/current-matches.js)) **открывать** WebSocket к `MM_CONFIG.wssBase…` **до** перехода на вкладку Fights, чтобы **прогреть** холодный Render; **подписки** `scoreboard:mat:…` — **только** при **показе** Fights (или сразу после `open`, если **уже** знаем `mat` из **предыдущего** кэша `fights` — осторожно, данные **могли** устареть).

**Плюс:** быстрее **первый** live-кадр.

**Минусы:** фоновое соединение, если пользователь **не** откроет Fights; на моб. — батарея; **лимиты** сокетов/таба.

**Рекомендация в плане:** **да, имеет смысл** **опционально**: после `DOMContentLoaded` (или `requestIdleCallback`) **один** `new WebSocket(wssBase)`; в `onopen` — **без** подписки на ковры, при необходимости **только** keep-alive (если прокси закрывает неактивных — **keepalive** ping раз в 30 s согласовать); при **входе** на Fights — **тот же** сокет **+** `send` подписок (или **переоткрыть** если `closed`). Если сокет **уже** закрылся — обычный **reconnect** с backoff. **Переключать** preconnect **off** в будущем через флаг в `config` при желании.

## Клиент [pl/events/current-matches/current-matches.js](../pl/events/current-matches/current-matches.js)

(Без изменения общей рамки прежнего плана: гибрид `fights` + `liveByMat`, дедуп, backoff, `leave` при уходе, слияние `rowHeadVariant` с WSS, поэтапная карта имён `scheduled/…` после живого ивента.)

## Порядок работ (черновик)

1. Три `wss-proxy.js` + **один** способ `PROXY_MODE` (production | devtest); **devtest** читает сценарий 628.
2. Сценарий **628** по **разделу выше** (фикстурный JSON).
3. [config.js](../config.js) `WSS_BASE_BY_MODE` + `MM_CONFIG`.
4. **Preconnect** + Fights: подписка и применение к DOM.
5. Сверка деплоев (master / release) с твоим **текущим** `BASE_BY_MODE` паттерном.

## Туды (трек)

- [ ] `WSS_BASE_BY_MODE` + `MM_CONFIG` (master/release как `BASE_BY_MODE`)
- [ ] `wss-proxy.js` x3 (или shared) + **devtest** 628 **цикличный** сценарий
- [ ] preconnect (idle) + **subscribe** на Fights
- [ ] [current-matches.js](../pl/events/current-matches/current-matches.js) live merge + дедуп + leave
- [ ] Доку: три среды, какой URL куда, релиз = копия test

---

*Создано как живая копия плана в репо; дорабатывать в этом файле при новых договорённостях.*
