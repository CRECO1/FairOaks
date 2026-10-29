// Fixed phrases the voice routes speak themselves (not the model), in both languages the bot answers in.
export type Lang = 'en' | 'es';

const LINES = {
  sorryRepeat: { en: 'Sorry, could you say that again?', es: 'Perdón, ¿me lo puede repetir?' },
  trouble: {
    en: "I'm having trouble on my end. An agent will call you back at the number you're calling from as soon as possible. Goodbye.",
    es: 'Tengo un problema de mi lado. Un agente le devolverá la llamada al número desde el que llama lo antes posible. Adiós.',
  },
  noCatch: {
    en: "I'm sorry, I didn't catch that. Could you tell me your name and the best number to reach you?",
    es: 'Perdón, no le entendí. ¿Me puede dar su nombre y el mejor número para llamarle?',
  },
  wentWrong: {
    en: 'Sorry, something went wrong on our end. Please call back in a moment.',
    es: 'Perdón, tuvimos un problema de nuestro lado. Por favor llame de nuevo en un momento.',
  },
  timedOut: {
    en: "I'm sorry, that's taking longer than it should. An agent will call you back as soon as possible. Goodbye.",
    es: 'Perdón, esto está tardando más de lo normal. Un agente le devolverá la llamada lo antes posible. Adiós.',
  },
  maxTurns: {
    en: 'Thank you. I have everything I need, and an agent will call you back as soon as possible. Goodbye.',
    es: 'Gracias. Ya tengo todo lo que necesito y un agente le devolverá la llamada lo antes posible. Adiós.',
  },
  transferFailed: {
    en: "I wasn't able to reach anyone. An agent will call you back as soon as possible. Goodbye.",
    es: 'No pude comunicarme con nadie. Un agente le devolverá la llamada lo antes posible. Adiós.',
  },
  // The ring went unanswered / failed: Ava takes the message herself.
  transferMissed: {
    en: "I'm sorry, I wasn't able to reach them just now. I'll make sure they get your message. Can I get your name and the best number to reach you?",
    es: 'Lo siento, no pude comunicarme con ellos en este momento. Me aseguraré de que reciban su mensaje. ¿Me da su nombre y el mejor número para llamarle?',
  },
  // The ring went unanswered but Ava already has the caller's name and number.
  transferMissedKnown: {
    en: "I'm sorry, I wasn't able to reach them just now. I have your name and number, and I'll make sure they call you back as soon as possible. Is there anything else you'd like me to pass along?",
    es: 'Lo siento, no pude comunicarme con ellos en este momento. Ya tengo su nombre y su número, y me aseguraré de que le devuelvan la llamada lo antes posible. ¿Hay algo más que quiera que les transmita?',
  },
  // Transfer asked for but not possible right now (after hours / switched off).
  noTransfer: {
    en: "I'm not able to connect you right now, but I'll make sure they get your message. Can I get your name and the best number to reach you?",
    es: 'No puedo comunicarle en este momento, pero me aseguraré de que reciban su mensaje. ¿Me da su nombre y el mejor número para llamarle?',
  },
} as const;

const HOLD = {
  en: ['One moment while I look that up.', 'Let me check on that for you.', 'Just a second.'],
  es: ['Un momento, por favor.', 'Déjeme revisarlo.', 'Un segundo.'],
};

export const line = (key: keyof typeof LINES, lang: Lang = 'en'): string => LINES[key][lang] ?? LINES[key].en;
export const holdLine = (n: number, lang: Lang = 'en'): string => HOLD[lang][n % HOLD[lang].length];
export const asLang = (v: unknown): Lang => (v === 'es' ? 'es' : 'en');
