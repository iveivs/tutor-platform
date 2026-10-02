"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Language = "ru" | "en";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue>({ language: "ru", setLanguage: () => undefined });
const STORAGE_KEY = "tutor-platform-language";

const translations: Record<string, string> = {
  "Включить светлую тему": "Switch to light theme", "Включить тёмную тему": "Switch to dark theme", "Светлая тема": "Light theme", "Тёмная тема": "Dark theme",
  "Платформа репетитора": "Tutor Platform", "Войдите в свой кабинет": "Sign in to your account", "Войти": "Sign in", "Входим…": "Signing in…", "Пароль": "Password",
  "Забыли пароль?": "Forgot your password?", "или": "or", "Создать кабинет преподавателя": "Create a tutor account", "Если вас пригласили как ученика, откройте персональную ссылку преподавателя.": "If you were invited as a student, open the personal link sent by your tutor.",
  "Восстановление пароля": "Password recovery", "Пришлём ссылку для создания нового пароля": "We’ll send you a link to create a new password", "Отправить ссылку": "Send link", "Отправляем…": "Sending…", "Вернуться ко входу": "Back to sign in",
  "Если аккаунт с таким email существует, письмо со ссылкой уже отправлено. Проверьте также папку «Спам».": "If an account with this email exists, a recovery link has been sent. Please also check your spam folder.",
  "Новый кабинет": "New account", "Для преподавателя, тренера или наставника": "For tutors, coaches, and mentors", "Название или роль": "Title or role", "Репетитор, тренер…": "Tutor, coach…", "Повторите пароль": "Repeat password", "Создать кабинет": "Create account", "Создаём…": "Creating…", "Сайт": "Website",
  "Проверьте почту и подтвердите email. Отдельный кабинет будет создан автоматически при первом входе.": "Check your inbox and confirm your email. Your account will be created automatically when you first sign in.", "Перейти ко входу": "Go to sign in", "Пароли не совпадают": "Passwords do not match",
  "Обзор": "Overview", "Календарь": "Calendar", "Ученики": "Students", "Запросы": "Requests", "История": "History", "Настройки": "Settings", "Выйти": "Sign out", "Уведомления": "Notifications", "Основная навигация": "Main navigation", "Мобильная навигация": "Mobile navigation",
  "Сегодня": "Today", "Вчера": "Yesterday", "Завтра": "Tomorrow", "Назад": "Back", "Вперёд": "Next", "День": "Day", "Неделя": "Week", "Месяц": "Month", "Предыдущий день": "Previous day", "Следующий день": "Next day",
  "Ваш рабочий день": "Your workday", "Расписание на день": "Daily schedule", "На этот день уроков нет": "No lessons on this day", "Показывать прошедшие уроки": "Show past lessons", "Загружаю прошедшие…": "Loading past lessons…",
  "Следующий урок": "Next lesson", "Следующий урок пока не назначен": "No upcoming lesson yet", "Запросы на рассмотрении": "Pending requests", "Всё в порядке — ничего срочного.": "Everything is on track — nothing needs attention.", "Требуют внимания": "Needs attention",
  "Добавить урок": "Add lesson", "Новый урок": "New lesson", "Добавьте обычное или бесплатное пробное занятие.": "Add a regular or free trial lesson.", "Ученик": "Student", "Выберите ученика": "Select a student", "Тип занятия": "Lesson type", "Обычное занятие": "Regular lesson", "Пробное занятие · бесплатно": "Trial lesson · free",
  "Дата": "Date", "Время": "Time", "Продолжительность": "Duration", "Обычный урок · 1 час": "Regular lesson · 1 hour", "Двойной урок · 2 часа": "Double lesson · 2 hours", "Повторение": "Repeat", "Не повторять": "Do not repeat", "Каждую неделю": "Every week",
  "Будут созданы два связанных занятия подряд. Они переносятся и отменяются вместе, а после проведения с баланса списываются два занятия.": "Two linked consecutive lessons will be created. They are rescheduled or cancelled together, and two lessons are deducted after completion.", "Пробное занятие длится один час, не повторяется и не влияет на баланс ученика.": "A trial lesson lasts one hour, does not repeat, and does not affect the student’s balance.",
  "Отмена": "Cancel", "Сохранить урок": "Save lesson", "Сохранить двойной урок": "Save double lesson", "Сохранить пробное занятие": "Save trial lesson", "Сохраняю…": "Saving…", "Пробное занятие": "Trial lesson", "Бесплатное разовое занятие на один час.": "A free one-time lesson lasting one hour.",
  "Кому назначить": "Assign to", "Новому посетителю": "New visitor", "Существующему ученику без платных занятий": "Existing student with no paid lesson history", "Имя *": "Name *", "Имя посетителя": "Visitor name", "Телефон": "Phone", "Заметка": "Note", "Необязательно": "Optional",
  "Посетитель не появится в списке учеников. После занятия его можно преобразовать в ученика из календаря.": "The visitor will not appear in the student list. After the lesson, you can convert them to a student from the calendar.",
  "Добавить ученика": "Add student", "Новый ученик": "New student", "Создайте карточку ученика для расписания и учёта оплат.": "Create a student profile for scheduling and payment tracking.", "Имя ученика": "Student name", "Фамилия": "Last name", "Тип расписания": "Schedule type", "Постоянное": "Fixed", "Плавающее": "Flexible", "День недели": "Day of week",
  "Email нужен только для личного кабинета ученика. Расписание, занятия и оплаты можно вести без него.": "Email is only needed for the student portal. You can manage schedules, lessons, and payments without it.", "Создать ученика": "Create student", "Понедельник": "Monday", "Вторник": "Tuesday", "Среда": "Wednesday", "Четверг": "Thursday", "Пятница": "Friday", "Суббота": "Saturday", "Воскресенье": "Sunday",
  "Пн": "Mon", "Вт": "Tue", "Ср": "Wed", "Чт": "Thu", "Пт": "Fri", "Сб": "Sat", "Вс": "Sun",
  "Поиск по имени": "Search by name", "Все": "All", "с задолженностью": "with outstanding balance", "без следующего урока": "without an upcoming lesson", "Ученики не найдены": "No students found", "Расписание": "Schedule", "Баланс": "Balance", "Статус": "Status", "Архив": "Archive", "В архиве": "Archived",
  "Открыть карточку": "Open profile", "Назад к ученикам": "Back to students", "Плавающее расписание": "Flexible schedule", "Постоянное расписание": "Fixed schedule", "Постоянное расписание не задано": "No fixed schedule", "Следующий урок назначается отдельно": "The next lesson is scheduled separately", "Регулярного расписания нет": "No recurring schedule",
  "Будущие уроки": "Upcoming lessons", "Оплаты": "Payments", "Данные ученика": "Student details", "Имя обязательно. Email нужен только для личного кабинета ученика.": "Name is required. Email is only needed for the student portal.", "Email уже связан со входом ученика и здесь не изменяется.": "Email is linked to the student’s sign-in account and cannot be changed here.",
  "Показывать свободные слоты": "Show available slots", "Ученик сможет видеть рабочие свободные часы и отправлять запрос на выбранное время.": "The student will be able to see available working hours and request a selected time.", "Изменить данные": "Edit details", "Сохранить": "Save", "Переместить в архив": "Move to archive",
  "Будущие уроки будут отменены, а история и оплаты сохранятся. Ученика можно восстановить.": "Future lessons will be cancelled, while history and payments will be preserved. The student can be restored.", "Ученик находится в архиве": "Student is archived", "Новые уроки и оплаты недоступны, но история сохранена. Ученика можно восстановить.": "New lessons and payments are unavailable, but history is preserved. The student can be restored.", "Восстановить ученика": "Restore student", "Удалить навсегда": "Delete permanently",
  "Окончательно удалить ученика?": "Permanently delete this student?", "Будут безвозвратно удалены уроки, оплаты, запросы, уведомления и история ученика. Для подтверждения введите его имя полностью.": "The student’s lessons, payments, requests, notifications, and history will be permanently deleted. Enter their full name to confirm.", "Удалить безвозвратно": "Delete permanently", "Удаляю…": "Deleting…",
  "Добавить оплату": "Add payment", "Количество занятий": "Number of lessons", "Дата оплаты": "Payment date", "Корректировать баланс": "Adjust balance", "Корректировка баланса": "Balance adjustment", "Изменение": "Adjustment", "Причина": "Reason", "Сохранить корректировку": "Save adjustment",
  "История пока пуста": "No history yet", "Уроки, оплаты и запросы": "Lessons, payments, and requests", "Урок": "Lesson", "Запрос": "Request", "Кто: ": "By: ", " · отменена": " · reversed", "Отменить оплату": "Reverse payment", "Отменить ошибочную оплату?": "Reverse this payment?", "Исходная запись останется в истории. Будет создана обратная операция, а баланс ученика уменьшится на то же количество занятий.": "The original entry will remain in history. A reversing entry will be created and the student’s balance will decrease by the same number of lessons.",
  "Профиль преподавателя": "Tutor profile", "Основные данные": "Basic information", "Это имя видно в меню и в кабинете ваших учеников.": "This name is shown in the menu and in your students’ portals.", "Имя преподавателя": "Tutor name", "Ваше имя": "Your name", "Например: Репетитор или Тренер": "For example: Tutor or Coach", "Email для входа": "Sign-in email", "Сохранить изменения": "Save changes",
  "Рабочие часы": "Working hours", "Настройте интервалы, которые ученики смогут видеть как доступные.": "Set the time windows students can see as available.", "Начало": "Start", "Конец": "End", "Добавить интервал": "Add time window", "Удалить интервал": "Remove time window", "Сохранить рабочие часы": "Save working hours",
  "Отмена урока": "Cancel lesson", "Перенос урока": "Reschedule lesson", "Новое занятие": "New lesson", "Запросить отмену": "Request cancellation", "Запросить перенос": "Request reschedule", "Предложить время урока": "Suggest lesson time", "Комментарий": "Comment", "Отправить запрос": "Send request", "Отправляю…": "Sending…",
  "Преподаватель получит запрос. Своевременный запрос не будет списан, даже если останется без ответа.": "The tutor will receive your request. A timely cancellation request will not be charged even if it remains unanswered.", "Предложите удобные дату и время. Урок появится в расписании после подтверждения преподавателем.": "Suggest a convenient date and time. The lesson will appear in the schedule after the tutor approves it.", "Выберите свободное время. Оно появится в расписании только после подтверждения преподавателем.": "Choose an available time. It will appear in the schedule only after the tutor approves it.",
  "Свободные слоты": "Available times", "Или другая дата": "Or another date", "Подходящих свободных слотов пока нет.": "No suitable available times yet.", "Выбрать свободное время": "Choose an available time", "После подтверждения появится один двойной урок на два часа, а после проведения спишутся два занятия.": "Once approved, one two-hour double lesson will be created, and two lessons will be deducted after completion.",
  "Все запросы обработаны": "All requests have been handled", "В этой категории запросов нет": "No requests in this category", "Перенос": "Reschedule", "Подтвердить": "Approve", "Отклонить": "Decline", "Ожидает решения": "Pending", "Подтверждён": "Approved", "Отклонён": "Declined", "Предложенное время": "Suggested time",
  "Привет, ": "Hello, ", "Ваше расписание занятий": "Your lesson schedule", "Ближайший урок": "Upcoming lesson", "Дальнейшие занятия": "Later lessons", "Отмену можно запросить до 23:59 предыдущего дня": "Cancellation can be requested until 11:59 PM on the previous day", "Необходимо оплатить ": "Payment required for ",
  "Кабинет ученика не найден": "Student portal not found", "Аккаунт вошёл, но не связан с карточкой ученика. Попросите преподавателя создать новое приглашение.": "You are signed in, but this account is not linked to a student profile. Ask your tutor to create a new invitation.", "Данные временно недоступны": "Data is temporarily unavailable", "Локальная база не ответила. Попробуйте ещё раз.": "The local database did not respond. Please try again.", "Повторить": "Try again",
  "Закрыть": "Close", "Отметить всё прочитанным": "Mark all as read", "Новых уведомлений нет": "No new notifications", "Открыть ученика": "Open student", "Обе части двойного урока будут перенесены или отменены вместе.": "Both parts of the double lesson will be rescheduled or cancelled together.", "Перенести оба": "Reschedule both", "Отменить оба занятия": "Cancel both lessons", "Перенести": "Reschedule", "Отменить урок": "Cancel lesson",
  "Управление платформой": "Platform management", "Список кабинетов преподавателей и управление доступом.": "Tutor accounts and access management.", "Преподаватель": "Tutor", "Создан": "Created", "Доступ": "Access", "Активен": "Active", "Заблокирован": "Blocked", "Заблокировать": "Block", "Разблокировать": "Unblock",
  "Персональная ссылка": "Personal link", "Ссылка на кабинет": "Portal link", "Готовим ссылку…": "Preparing link…", "Скопировать ссылку": "Copy link", "Отправить": "Send", "Пригласить ученика": "Invite student", "Отправить ссылку на кабинет": "Send portal link", "Ссылка действует 14 дней. Создание новой ссылки отключит предыдущую.": "The link is valid for 14 days. Creating a new link disables the previous one.", "Это обычная ссылка на вход, она не меняет пароль и не создаёт новое приглашение.": "This is a regular sign-in link. It does not change the password or create a new invitation.",
  "Проверка приглашения…": "Checking invitation…", "Приглашение ученика": "Student invitation", "Принять приглашение": "Accept invitation", "Принимаем…": "Accepting…", "Новый пароль": "New password", "Сохранить пароль": "Save password", "Сохраняем…": "Saving…",
  "Кабинет ученика": "Student portal", "Здравствуйте, ": "Hello, ", "Проверяем приглашение…": "Checking invitation…", "Аккаунт готов": "Your account is ready", "Придумайте пароль": "Create a password", "Введите прежний пароль": "Enter your existing password", "Так мы безопасно подтвердим, что аккаунт принадлежит вам.": "This securely confirms that the account belongs to you.", "Минимум 8 символов.": "At least 8 characters.", "Проверяем…": "Checking…", "Подключить существующий аккаунт": "Link existing account", "Создать аккаунт": "Create account",
  "Теперь войдите с вашим email и ": "Now sign in with your email and ", "прежним": "existing", "новым": "new", " паролем.": " password.",
  "Придумайте пароль длиной не менее 8 символов": "Create a password at least 8 characters long", "Пароль изменён. Теперь можно войти с новым паролем.": "Password updated. You can now sign in with your new password.",
  "Не удалось войти": "Could not sign in", "Не удалось отправить письмо": "Could not send the email", "Не удалось создать кабинет": "Could not create the account", "Не удалось выйти. Проверьте соединение и попробуйте снова.": "Could not sign out. Check your connection and try again.",
  "Не удалось загрузить данные": "Could not load data", "Не удалось загрузить прошедшие уроки": "Could not load past lessons", "Не удалось обновить уведомления": "Could not update notifications", "Не удалось обработать запрос": "Could not process the request", "Не удалось отправить запрос": "Could not send the request", "Не удалось добавить урок": "Could not add the lesson", "Не удалось отменить урок": "Could not cancel the lesson", "Не удалось перенести урок": "Could not reschedule the lesson",
  "Не удалось создать ученика": "Could not create the student", "Не удалось сохранить данные ученика": "Could not save student details", "Не удалось архивировать ученика": "Could not archive the student", "Не удалось восстановить ученика": "Could not restore the student", "Не удалось удалить ученика": "Could not delete the student", "Не удалось добавить оплату": "Could not add the payment", "Не удалось отменить оплату": "Could not reverse the payment", "Не удалось скорректировать баланс": "Could not adjust the balance", "Не удалось остановить расписание": "Could not stop the schedule", "Не удалось сохранить настройки": "Could not save settings", "Не удалось сохранить рабочие часы": "Could not save working hours", "Не удалось сохранить изменения": "Could not save changes", "Не удалось подготовить ссылку": "Could not prepare the link",
  "Урок добавлен в расписание": "Lesson added to the schedule", "Двойной урок добавлен в расписание": "Double lesson added to the schedule", "Пробное занятие добавлено в расписание": "Trial lesson added to the schedule", "Урок отменён без списания": "Lesson cancelled without charge", "Урок перенесён": "Lesson rescheduled", "Ученик создан": "Student created", "Ученик создан. Пригласить его можно из карточки": "Student created. You can invite them from their profile", "Карточка ученика создана": "Student profile created", "Данные ученика сохранены": "Student details saved", "Ученик перемещён в архив": "Student moved to archive", "Ученик восстановлен": "Student restored", "Ученик и связанные данные удалены": "Student and related data deleted",
  "Баланс скорректирован": "Balance adjusted", "Оплата отменена, баланс пересчитан": "Payment reversed and balance recalculated", "Постоянное занятие остановлено": "Recurring lesson stopped", "Профиль сохранён": "Profile saved", "Рабочие часы сохранены": "Working hours saved", "Запрос отправлен преподавателю": "Request sent to the tutor", "Запрос подтверждён": "Request approved", "Запрос отклонён": "Request declined", "Запрос уже неактуален и закрыт": "The request is no longer relevant and has been closed", "Ссылка скопирована — отправьте её ученику": "Link copied — send it to the student",
  "Проверьте ученика, дату и время": "Check the student, date, and time", "Ученик не найден": "Student not found", "Уточните ученика: найдены тёзки": "Please specify the student: duplicate names found", "Дата должна быть в формате ГГГГ-ММ-ДД": "Date must use the YYYY-MM-DD format", "Ссылка не была создана": "The link was not created", "Без комментария": "No comment", "Без урока": "No lesson", "Не назначен": "Not scheduled", "Истёк": "Expired", "Срок отмены истёк": "Cancellation deadline has passed",
  "Имя": "Name", "Уроки": "Lessons", "Задолженность": "Outstanding balance", "Изменение баланса": "Balance adjustment", "Новая дата": "New date", "Новое время": "New time", "Время занятия": "Lesson time", "Продолжительность урока": "Lesson duration", "Продолжительность: 1 час": "Duration: 1 hour", "Двойной урок · 2 занятия": "Double lesson · 2 lessons", "Двойной урок: 2 часа": "Double lesson: 2 hours", "Постоянные занятия не заданы": "No recurring lessons", "Перенесите урок или отмените его без списания.": "Reschedule the lesson or cancel it without charge.",
  "Остановить расписание": "Stop recurring schedule", "Останавливаю…": "Stopping…", "Отменяю…": "Reversing…", "Создаю…": "Creating…", "Уменьшить время на час": "Move time one hour earlier", "Увеличить время на час": "Move time one hour later", "Например: долг до начала работы в приложении": "For example: balance owed before using the app", "Долг до начала работы в приложении": "Balance owed before using the app",
  "Отправьте эту персональную ссылку ученику в Telegram, WhatsApp, почте или другом удобном месте. По ней ученик задаст пароль и войдёт в свой кабинет.": "Send this personal link to the student via Telegram, WhatsApp, email, or another convenient channel. They can use it to set a password and access their portal.", "Войдите в кабинет ученика по ссылке:": "Open the student portal using this link:", "Ссылка для входа в кабинет ученика:": "Student portal sign-in link:",
  "Ссылка недействительна": "This link is invalid", "Не удалось открыть приглашение": "Could not open the invitation", "Не удалось создать аккаунт": "Could not create the account", "Не удалось изменить пароль": "Could not update the password", "Не удалось загрузить кабинеты": "Could not load accounts", "Не удалось изменить доступ": "Could not change access", "Доступ к кабинету восстановлен": "Account access restored", "Доступ к кабинету приостановлен": "Account access suspended", "заблокировал": "blocked", "разблокировал": "unblocked",
  "Администрирование": "Administration", "Кабинеты преподавателей": "Tutor accounts", "Вернуться в кабинет": "Back to account", "Поиск по имени или email": "Search by name or email", "Обновить": "Refresh", "Загружаю кабинеты…": "Loading accounts…", "Кабинеты не найдены": "No accounts found", "Ваш кабинет": "Your account", "Приостановить доступ": "Suspend access", "Восстановить доступ": "Restore access", "Журнал административных действий": "Administrative activity log", "Последние 100 блокировок и разблокировок": "Last 100 blocks and unblocks", "Действий пока нет": "No activity yet", "Ещё не входили": "No sign-in yet",
  "Учеников: ": "Students: ", "Создан: ": "Created: ", "Активность: ": "Activity: ", "урок": "lesson", "урока": "lessons", "уроков": "lessons", "занятие": "lesson", "занятия": "lessons", "занятий": "lessons", "ученик": "student", "ученика": "students", "учеников": "students", "запрос": "request", "запроса": "requests", "запросов": "requests", "ожидают решения": "pending", " · двойной": " · double",
};

const months: Record<string, string> = { января: "January", февраля: "February", марта: "March", апреля: "April", мая: "May", июня: "June", июля: "July", августа: "August", сентября: "September", октября: "October", ноября: "November", декабря: "December" };
const weekdays: Record<string, string> = { понедельник: "Monday", вторник: "Tuesday", среда: "Wednesday", четверг: "Thursday", пятница: "Friday", суббота: "Saturday", воскресенье: "Sunday" };

export function translateUiText(value: string) {
  if (!/[А-Яа-яЁё]/.test(value)) return value;
  if (translations[value]) return translations[value];
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  if (translations[core]) return `${leading}${translations[core]}${trailing}`;

  let translated = core
    .replace(/^Кабинет ученика — (.+)$/, "Student portal — $1")
    .replace(/^Пригласить (.+)$/, "Invite $1")
    .replace(/^Введите: (.+)$/, "Enter: $1")
    .replace(/^Баланс: (-?\d+) занятия?$/, "Balance: $1 lessons")
    .replace(/^Баланс на момент архивации: (-?\d+) занятия?$/, "Balance when archived: $1 lessons")
    .replace(/^Текущий баланс: (-?\d+) занятия?$/, "Current balance: $1 lessons")
    .replace(/^После оплаты баланс составит (-?\d+) занятия?$/, "Balance after payment: $1 lessons")
    .replace(/^После корректировки баланс составит (-?\d+) занятия?$/, "Balance after adjustment: $1 lessons")
    .replace(/^(\d+) (ученик|ученика|учеников)$/, "$1 students")
    .replace(/^(\d+) (урок|урока|уроков)$/, "$1 lessons")
    .replace(/^(\d+) (занятие|занятия|занятий)$/, "$1 lessons")
    .replace(/^(\d+) (запрос|запроса|запросов)$/, "$1 requests")
    .replace(/ требуют ответа$/, " need attention")
    .replace(/ ожидают решения$/, " pending");
  for (const [month, english] of Object.entries(months)) translated = translated.replace(new RegExp(`\\b${month}\\b`, "gi"), english);
  for (const [weekday, english] of Object.entries(weekdays)) translated = translated.replace(new RegExp(`\\b${weekday}\\b`, "gi"), english);
  return `${leading}${translated}${trailing}`;
}

function localizeNode(root: Node, language: Language, originals: WeakMap<Node, string>, attributeOriginals: WeakMap<Element, Map<string, string>>) {
  const textNodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) textNodes.push(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  }
  for (const node of textNodes) {
    if (node.parentElement?.closest("script, style, [data-no-translate]")) continue;
    const previous = originals.get(node);
    if (!previous || (language === "en" && /[А-Яа-яЁё]/.test(node.data) && node.data !== translateUiText(previous))) originals.set(node, node.data);
    const original = originals.get(node) ?? node.data;
    const next = language === "en" ? translateUiText(original) : original;
    if (node.data !== next) node.data = next;
  }
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root as Element, ...(root as Element).querySelectorAll("*")] : [];
  for (const element of elements) {
    if (element.closest("[data-no-translate]")) continue;
    for (const attribute of ["aria-label", "title", "placeholder"]) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      let stored = attributeOriginals.get(element);
      if (!stored) { stored = new Map(); attributeOriginals.set(element, stored); }
      const previous = stored.get(attribute);
      if (!previous || (language === "en" && /[А-Яа-яЁё]/.test(current) && current !== translateUiText(previous))) stored.set(attribute, current);
      const original = stored.get(attribute) ?? current;
      const next = language === "en" ? translateUiText(original) : original;
      if (current !== next) element.setAttribute(attribute, next);
    }
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ru");
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const originals = useRef(new WeakMap<Node, string>());
  const attributeOriginals = useRef(new WeakMap<Element, Map<string, string>>());
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ru") setLanguageState(saved);
    setPreferenceLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferenceLoaded) return;
    document.documentElement.lang = language;
    document.title = language === "en" ? "Tutor Platform — lesson scheduling" : "Репетитор — расписание занятий";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = language === "en" ? "Scheduling, students, and payments for private tutors." : "Расписание, ученики и оплаты частного преподавателя.";
    window.localStorage.setItem(STORAGE_KEY, language);
    const apply = (node: Node) => localizeNode(node, language, originals.current, attributeOriginals.current);
    apply(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") apply(mutation.target);
        for (const node of mutation.addedNodes) apply(node);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [language, preferenceLoaded]);
  const value = useMemo(() => ({ language, setLanguage: setLanguageState }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }
