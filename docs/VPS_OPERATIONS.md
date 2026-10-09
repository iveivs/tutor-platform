# Эксплуатация Tutor Platform на VPS

Этот регламент относится к действующему production-контуру Node/PostgreSQL на VPS Selectel. Cloudflare/D1/Supabase сохранены только как архив прежней архитектуры и не получают новые рабочие записи.

## До первого запуска

1. Использовать отдельный Linux VPS с актуальными обновлениями безопасности и Docker Compose.
2. Разрешить во внешнем firewall только SSH, HTTP и HTTPS. Порт PostgreSQL наружу не публикуется.
3. Создать `.env` вне Git на основе `.env.example`, установить права `600` и сгенерировать независимые длинные значения `POSTGRES_PASSWORD`, `AUTH_SECRET` и `RESTIC_PASSWORD`.
4. Настроить отдельный приватный S3-совместимый bucket. Ключу резервного копирования выдать доступ только к префиксу Tutor Platform, без доступа к другим данным аккаунта.
5. Сохранить копии production-переменных и `RESTIC_PASSWORD` в отдельном менеджере секретов. Потеря `RESTIC_PASSWORD` делает зашифрованные резервные копии невосстановимыми.
6. Для почты задать Selectel SMTP через TLS: `SMTP_HOST=smtp.mail.selcloud.ru`, `SMTP_PORT=1127`, `SMTP_SECURE=true`, логин, пароль и адрес отправителя на подтверждённом домене. Пароль не выводить при проверке конфигурации.
7. Selectel VPS не достигает `api.telegram.org`, поэтому развернуть `workers/telegram-relay/` в Cloudflare. Добавить в Worker secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` и независимый `TELEGRAM_RELAY_SECRET`. На VPS задать имя бота без `@`, тот же webhook-secret и relay-secret, а `TELEGRAM_API_BASE_URL` установить в `https://<relay>.workers.dev/bot`. Пустые Telegram-переменные безопасно оставляют модуль выключенным.

## Telegram relay

Шлюз не хранит данные и не ведёт журнал содержимого сообщений. Он принимает от VPS только четыре разрешённых метода Bot API, проверяя `x-telegram-relay-secret`, и передаёт входящие Telegram updates единственному адресу `https://tyuttori.ru/api/telegram/webhook`. Бесплатного лимита Cloudflare Workers с большим запасом достаточно для текущего объёма уведомлений.

Развернуть код и добавить секреты интерактивно, не передавая их аргументами командной строки:

```bash
npm run telegram:relay:deploy
npx wrangler secret put TELEGRAM_BOT_TOKEN --config workers/telegram-relay/wrangler.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config workers/telegram-relay/wrangler.jsonc
npx wrangler secret put TELEGRAM_RELAY_SECRET --config workers/telegram-relay/wrangler.jsonc
```

После заполнения VPS зарегистрировать webhook через relay. Тело запроса игнорируется: шлюз сам подставляет собственный публичный адрес, secret-token и единственный разрешённый тип update `message`.

```bash
curl --fail --silent --show-error --request POST \
  --header "x-telegram-relay-secret: $TELEGRAM_RELAY_SECRET" \
  --header "content-type: application/json" \
  --data '{}' "$TELEGRAM_API_BASE_URL/setWebhook"
curl --fail --silent --show-error --request POST \
  --header "x-telegram-relay-secret: $TELEGRAM_RELAY_SECRET" \
  --header "content-type: application/json" \
  --data '{}' "$TELEGRAM_API_BASE_URL/getWebhookInfo"
```

Не выводить ответы `getMe`, webhook payload, `chat_id` и значения секретов в общие логи. При ротации менять relay-secret в Worker и на VPS согласованно; webhook-secret — в Worker и приложении, затем повторять `setWebhook`.

## Запуск и обновление

Проверить конфигурацию без вывода секретов:

```bash
docker compose --profile operations config --quiet
```

При первом запуске один раз инициализировать пустой Restic-репозиторий. Для уже существующего репозитория этот шаг повторять нельзя:

```bash
docker compose --profile operations run --rm --entrypoint restic backup init
```

Собрать образы и запустить контур:

```bash
docker compose --profile operations up -d --build
```

Сервис `migrate` завершается до запуска приложения и worker. Миграции PostgreSQL применяются под advisory lock. Если миграция не завершилась успешно, `app` и `worker` не запускаются.

Контейнеры приложения, worker и backup работают с read-only root filesystem, без Linux capabilities и с `no-new-privileges`; временные файлы доступны только в отдельном `tmpfs`.

После запуска проверить состояние:

```bash
PUBLIC_APP_URL=https://your-domain.example ./scripts/check-vps-operations.sh
```

Для обычного обновления сначала создать резервную копию, затем получить проверенный коммит, пересобрать образы и снова выполнить эксплуатационную проверку. Не использовать плавающие или непроверенные ветки как production-источник.

## Резервные копии

Профиль `operations` запускает сервис `backup`. Раз в сутки он передаёт `pg_dump` напрямую в Restic без незашифрованного файла на диске VPS. Restic шифрует данные до отправки в S3. По умолчанию сохраняются 7 ежедневных, 4 еженедельных и 6 ежемесячных снимков.

Проверить наличие снимков:

```bash
docker compose --profile operations run --rm --entrypoint restic backup snapshots --tag postgres
```

Автоматическая healthcheck считает backup нездоровым, если последний успешный снимок старше 26 часов. Целевой RPO — не более 24 часов. Ошибки backup-контейнера должны попадать во внешнее наблюдение VPS.

## Проверка восстановления

Не реже одного раза в месяц и перед переключением production выполнить полный тест восстановления:

```bash
docker compose --profile operations run --rm --entrypoint verify-postgres-backup backup
```

Команда проверяет Restic-репозиторий, создаёт временную базу со случайным безопасным именем, восстанавливает последний снимок, проверяет обязательные таблицы, связи, списания, возвраты и хеши сессий, после чего удаляет только эту временную базу. Успешный `pg_dump` без такого теста не считается проверенной резервной копией.

Эксплуатационная проверка вместе с restore drill:

```bash
PUBLIC_APP_URL=https://your-domain.example VERIFY_BACKUP_RESTORE=true ./scripts/check-vps-operations.sh
```

## Аварийное восстановление

1. Остановить запись: `docker compose stop caddy app worker backup`.
2. Убедиться, что выбран правильный снимок: `restic snapshots --tag postgres` через backup-контейнер.
3. Сначала восстановить снимок во временную базу командой проверки выше.
4. Только после успешной проверки восстановить целевую базу. Скрипт требует точного имени и отдельной строки подтверждения:

```bash
docker compose --profile operations run --rm \
  -e RESTORE_TARGET_DATABASE=tutor_platform \
  -e RESTORE_CONFIRMATION=RESTORE:tutor_platform \
  --entrypoint restore-postgres-backup backup
```

Скрипт удаляет и заново создаёт только явно указанную базу, отказывается работать с `postgres`, `template0` и `template1`, затем выполняет те же проверки целостности. После восстановления запустить `migrate`, `app`, `worker`, `caddy`, проверить вход администратора и ключевые пользовательские сценарии, затем снова включить backup.

## Наблюдение и инциденты

- `/api/health/live` подтверждает, что процесс приложения отвечает; `/api/health/ready` дополнительно проверяет PostgreSQL.
- Успешный `lesson-maintenance` должен появляться в `job_runs` не реже одного раза в 30 минут.
- Если Telegram включён, контролировать число `failed` и старых `pending` в `telegram_deliveries`; текст сообщений и идентификаторы чатов в мониторинг не выводить.
- Контролировать заполнение диска, память, перезапуски контейнеров, срок TLS-сертификата, ответы `5xx`, задержку PostgreSQL и свежесть backup.
- Не журналировать `.env`, cookies, токены приглашений, пароли, исходные email из auth-аудита и содержимое базы.
- При компрометации менять соответствующие ключи. Смена `AUTH_SECRET` прекращает корреляцию старых audit-хешей; смена `RESTIC_PASSWORD` выполняется средствами Restic и требует отдельной проверки восстановления.

## Откат приложения

После начала записи в PostgreSQL откат выполняется на предыдущий проверенный образ приложения поверх той же PostgreSQL-базы. Возвращать DNS на старую D1 нельзя: новые записи будут потеряны. Старый Cloudflare-контур удаляется только после согласованного периода наблюдения и отдельного подтверждения владельца.
