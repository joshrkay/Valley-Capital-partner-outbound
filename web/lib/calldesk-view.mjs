// Pure helpers for the call desk page (no engine, no network, no clock of their own): the read-aloud time of a voicemail script, the
// recipient's local time, and a tel: link. The desk plays no audio and records none, so none of this touches a microphone or a speaker.

// A placeholder pace: about 150 words a minute. The page's stopwatch is how a principal checks their own pace.
export const WORDS_PER_SECOND = 2.5;
export const TARGET_SECONDS = 20;     // the voicemail the drafter writes (src/draft.mjs CHANNEL_BRIEF)
export const LONG_SECONDS = 25;       // past this, the script is too long to leave comfortably

export const wordCount = (text) => (String(text ?? '').match(/\S+/g) ?? []).length;

// { words, seconds, verdict }: verdict is 'ok' (within the target), 'long' (over the target, up to the limit) or 'too_long' (over it).
export function readTime(text, wordsPerSecond = WORDS_PER_SECOND) {
  const words = wordCount(text);
  const seconds = Math.round(words / wordsPerSecond);
  const verdict = seconds <= TARGET_SECONDS ? 'ok' : seconds <= LONG_SECONDS ? 'long' : 'too_long';
  return { words, seconds, verdict };
}

// The recipient's weekday and clock in an IANA zone, for example "Mon 10:30 AM (America/Chicago)". Null when there is no valid zone.
export function localClock(now, timeZone) {
  if (!timeZone) return null;
  try {
    const t = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
    return `${t} (${timeZone})`;
  } catch { return null; }
}

// A tel: link for a phone number as people write it. Digits and a leading + only, so nothing else can ride in the href. Null when it
// has too few digits to dial. The principal still presses call: this opens a dialer, it dials nothing.
export function telHref(phone) {
  const s = String(phone ?? '').trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${s.startsWith('+') ? '+' : ''}${digits}`;
}
