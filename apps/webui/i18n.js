const TRANSLATIONS = {
  en: {
    custom_instructions_placeholder: "Additional behavior, style, and tone preferences",
    nickname_placeholder: "Nickname",
    occupation_placeholder: "Occupation",
    more_about_you_placeholder: "More about you",
    change_now: "Change now (no restart)",
    language_label: "Language",
    language_english: "English",
    language_russian: "Русский",
    language_ukrainian: "Українська",
    new_chat: "New chat",
    chat: "Chat",
    library: "Library",
    personalization: "Personalization",
    settings: "Settings",
    info: "Info",
    help: "Help",
    your_chats: "Your chats",
    loading_chats: "Loading chats…",
    ask_placeholder: "Ask anything about your knowledge base...",
    attach_files: "Attach files",
    attached_prefix: "Attached",
    send: "Send",
    searching: "Searching the knowledge base…",
    drafting: "Drafting an answer…",
    refining: "Refining the final answer…",
    assistant_thinking: "Assistant is thinking…",
    assistant_modes: "Assistant modes",
  },
  ru: {
    custom_instructions_placeholder: "Дополнительные инструкции по поведению, стилю и тону",
    nickname_placeholder: "Имя",
    occupation_placeholder: "Род занятий",
    more_about_you_placeholder: "Больше о вас",
    change_now: "Применить сразу (без перезапуска)",
    language_label: "Язык",
    language_english: "English",
    language_russian: "Русский",
    language_ukrainian: "Українська",
    new_chat: "Новый чат",
    chat: "Чат",
    library: "Библиотека",
    personalization: "Персонализация",
    settings: "Настройки",
    info: "Инфо",
    help: "Помощь",
    your_chats: "Ваши чаты",
    loading_chats: "Загрузка чатов…",
    ask_placeholder: "Спросите что угодно о вашей базе знаний...",
    attach_files: "Прикрепить файлы",
    attached_prefix: "Прикреплено",
    send: "Отправить",
    searching: "Поиск в базе знаний…",
    drafting: "Создание черновика ответа…",
    refining: "Уточнение финального ответа…",
    assistant_thinking: "Ассистент думает…",
    assistant_modes: "Режимы ассистента",
  },
  uk: {
    custom_instructions_placeholder: "Додаткові інструкції щодо стилю та тону",
    nickname_placeholder: "Імʼя",
    occupation_placeholder: "Професія",
    more_about_you_placeholder: "Більше про вас",
    change_now: "Змінити зараз (без перезапуску)",
    language_label: "Мова",
    language_english: "English",
    language_russian: "Русский",
    language_ukrainian: "Українська",
    new_chat: "Новий чат",
    chat: "Чат",
    library: "Бібліотека",
    personalization: "Персоналізація",
    settings: "Налаштування",
    info: "Інфо",
    help: "Довідка",
    your_chats: "Ваші чати",
    loading_chats: "Завантаження чатів…",
    ask_placeholder: "Запитайте будь-що про вашу базу знань...",
    attach_files: "Додати файли",
    attached_prefix: "Додано",
    send: "Надіслати",
    searching: "Пошук у базі знань…",
    drafting: "Створення чернетки відповіді…",
    refining: "Уточнення фінальної відповіді…",
    assistant_thinking: "Асистент думає…",
    assistant_modes: "Режими асистента",
  },
};

export const SUPPORTED_LOCALES = ["en", "ru", "uk"];
export const DEFAULT_LOCALE = "en";

export function normalizeLocale(rawLocale) {
  const locale = String(rawLocale || "").trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

export function createTranslator(locale) {
  const normalized = normalizeLocale(locale);
  const catalog = TRANSLATIONS[normalized] || TRANSLATIONS[DEFAULT_LOCALE];

  return function t(key, fallback = "") {
    return catalog[key] || TRANSLATIONS[DEFAULT_LOCALE][key] || fallback || key;
  };
}
