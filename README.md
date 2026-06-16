# BLACK RUSSIA — Игра на выживание

Готовый статический сайт для Discord-ивента: ведущий создаёт игру и invite-ссылку, игроки заходят по ссылке, вводят ник, отвечают на вопросы и выбывают после потери жизней.

## Что внутри

- `index.html` — сайт, панель ведущего и страница игрока в одном файле.
- `styles.css` — оформление в тёмном красно-чёрном стиле.
- `app.js` — логика игры и подключение Supabase.
- `assets/banner.png` — баннер/фон.
- `supabase/schema.sql` — таблицы, RLS-политики и функции Supabase.

## Данные Supabase уже вставлены

```js
const SUPABASE_URL = 'https://gqfpiyytofsydcpipnty.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_wWSjHfnSG1FJkYzdLslqNA_p6mKD8yn';
const OWNER_EMAIL = 'daniiltimosin72@gmail.com';
```

## Как запустить

### 1. Создать таблицы в Supabase

Открой Supabase → SQL Editor → New query → вставь весь код из:

```txt
supabase/schema.sql
```

Нажми **Run**.

### 2. Включить вход для владельца

В Supabase открой:

Authentication → Providers → Email

Включи Email provider. Для входа используется Magic Link.

В Authentication → URL Configuration добавь адрес сайта в разрешённые Redirect URLs.
Например для локального запуска:

```txt
http://localhost:3000
http://localhost:3000/?admin=1
```

Для Vercel/Netlify потом добавь боевой домен.

### 3. Запустить сайт локально

Самый простой вариант:

```bash
npx serve .
```

И открыть:

```txt
http://localhost:3000/?admin=1
```

### 4. Создать игру

1. Перейди на `/?admin=1`.
2. Войди через email `daniiltimosin72@gmail.com`.
3. Нажми **Создать игру**.
4. Проверь/измени вопросы JSON.
5. Нажми **Создать invite-ссылку**.
6. Скопируй ссылку и отправь игрокам в Discord.

## Как проходит игра

- Игроки заходят по invite-ссылке.
- Вводят ник.
- Ждут старта.
- Ведущий нажимает **Старт**.
- Игроки отвечают на активный вопрос.
- За правильный ответ даётся +1 очко.
- За неправильный ответ снимается 1 жизнь.
- Когда жизни закончились, игрок выбывает.
- Ведущий переключает вопросы кнопкой **Следующий вопрос**.
- В конце нажимает **Завершить**.

## Ограничение владельца

Создать игру и invite-ссылку может только Supabase Auth аккаунт:

```txt
daniiltimosin72@gmail.com
```

Это ограничение стоит не только в интерфейсе, но и в SQL/RLS-политиках Supabase.

## Важно по безопасности

В сайт вставлен только publishable key Supabase. Это нормально для frontend-сайта.
Никогда не вставляй в frontend `service_role` ключ.

## Настройка вопросов

Вопросы хранятся JSON-массивом. Формат одного вопроса:

```json
{
  "question_order": 0,
  "question_text": "Что тяжелее: 1 кг железа или 1 кг ваты?",
  "option_a": "Железо",
  "option_b": "Вата",
  "option_c": "Одинаково",
  "option_d": "Зависит от объёма",
  "correct_option": "C"
}
```

`correct_option` может быть только `A`, `B`, `C` или `D`.
