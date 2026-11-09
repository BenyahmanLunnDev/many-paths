// Works out whether a meeting is held in English (the Android app's Language.kt). Feeds rarely
// say: the online NA server marks almost everything "en", and 12 Step Meeting List sites reuse
// short type codes for different things. So explicit tags are trusted only where they're
// unambiguous, then the name and the meeting's home time zone decide. When unsure the answer
// is null, and the meeting stays visible.

const tsmlLanguages = {
  S: "Spanish", ES: "Spanish", FR: "French", POL: "Polish", POR: "Portuguese",
  RUS: "Russian", JA: "Japanese", KOR: "Korean", HE: "Hebrew", PUN: "Punjabi", ITA: "Italian",
};

/** true = English (or bilingual), false = another language, null = the tags don't say. */
export function fromTsmlCodes(codes) {
  const upper = codes.map((c) => c.trim().toUpperCase());
  if (upper.includes("EN")) return true;
  return upper.some((c) => Object.hasOwn(tsmlLanguages, c)) ? false : null;
}

let displayNames = null;

/** BMLT's per-meeting language; most servers default it to "en", so only other values count. */
export function bmltLanguageName(lang) {
  const code = lang?.trim().toLowerCase();
  if (!code || code === "en") return null;
  try {
    displayNames ??= new Intl.DisplayNames(["en-US"], { type: "language" });
    const name = displayNames.of(code);
    return name && name.toLowerCase() !== code ? name : null;
  } catch {
    return null;
  }
}

// Words that show up in names of meetings held in Spanish, Portuguese, French, German,
// Italian, Dutch or Scandinavian languages, and almost never in English names.
const strongForeign = new Set([
  "grupo", "grupa", "gruppe", "gruppen", "groupe", "groep", "reunion", "reuniao", "reunión", "réunion",
  "reunião", "sesion", "sesión", "sessao", "sessão", "recuperacion", "recuperación", "recuperacao",
  "recuperação", "sobriedad", "sobriedade", "español", "espanol", "espanhol", "portugues", "português",
  "deutsch", "français", "francais", "italiano", "nederlands", "svenska", "dansk", "norsk", "farsi",
  "lingua", "idioma", "sprache", "langue", "sérénité", "rétablissement",
  "genesung", "treffen", "serenidad", "serenidade", "sobrios", "sóbrios",
]);

// English names for languages count only when used as one: "(Dutch)", "Spanish Language",
// "Russian Speaking", "Nepali Meeting", "in Polish". "As Dutch Sees It" is an English meeting.
const languageNames = [
  "spanish", "german", "dutch", "french", "portuguese", "italian", "russian", "polish", "arabic",
  "hebrew", "swedish", "persian", "chinese", "japanese", "korean", "vietnamese", "ukrainian",
  "punjabi", "nepali", "bengali", "bangla", "hindi", "urdu", "turkish", "greek", "romanian",
  "hungarian", "czech", "slovak", "finnish", "norwegian", "danish", "tagalog",
].join("|");
const namedLanguage = new RegExp(
  `\\(\\s*(${languageNames})\\b|\\b(${languageNames})[\\s-]+(language|speaking|speakers|only|meeting|meetings|group)\\b|\\bin\\s+(${languageNames})\\b`,
);

// Common words in French, German, Italian, Portuguese and other meeting names that English
// names don't use. Each one adds as much as a likely-foreign word.
const foreignWords = new Set([
  // French
  "sans", "soucis", "avec", "dans", "chez", "nous", "notre", "vous", "toi", "moi", "ligne", "souffle",
  "nouveau", "nouvelle", "bonheur", "ensemble", "pouvons", "espoir", "echange", "ombre",
  "cote", "autre", "etoiles", "veille", "libre", "vivre", "fete", "juste", "aujourd", "spirituels",
  "spirituel", "principes", "souper", "presque", "parfait", "pleine", "lune", "virtuelle", "virtuel",
  "ponts", "dieu", "drogue", "tonnerre", "cour", "trop", "jour", "soir", "matin", "bruxelles",
  // German
  "schritte", "frauen", "einheit", "gelassen", "gemeinsam", "heute", "jetzt", "zeiten", "krankheit",
  "sucht", "keine", "feiertage", "entscheidung", "trafen", "reise", "geht", "weiter", "leben", "zwei",
  "neue", "vertrauen", "dauerhaftes", "deutschsprachige", "deutschlandweit", "funktioniert",
  "einwahl", "telefonische", "wochenende", "abend", "tiefpunkt", "kapitulier", "schreib",
  "schrittearbeit", "wien", "hoffnung", "freiheit", "zusammen", "gemeinschaft",
  // Italian
  "insieme", "possiamo", "vivere", "puliti", "cosa", "posso", "gratitudine", "dipendenti",
  "gruppo", "nuovo", "speranza", "oggi", "siamo", "liberi", "napoli", "firenze", "milano", "torino",
  // Portuguese and Spanish
  "juntos", "conseguimos", "sozinhos", "amigos", "uniao", "horizonte", "primeira", "clareza",
  "harmonia", "lusofonos", "groupo", "nordeste", "quarentena", "coragem", "gratidao", "pasando",
  "somos", "hoy", "nosotros",
  // Swedish, Farsi, Bengali and Indonesian names written in Latin letters
  "livsgnistan", "davazdahghadam", "azadi", "neshat", "suprobhat", "shuvo", "ratri", "sekitar",
]);

// Day names say a lot: "Lundi sans soucis", "Donnerstag NAchtmeeting". Portuguese "segunda",
// "quinta" and so on are left out because they're also US place names (La Quinta, CA).
const foreignDays = new Set([
  "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
  "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags", "sonntags",
  "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato", "domenica",
  "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag",
  "mandag", "tisdag", "onsdag", "torsdag", "fredag", "lordag", "sondag",
]);

// French inclusive spelling, as in "Queer·es, Clean·es, Serein·es".
const interpunct = /\p{L}·\p{L}/u;

// French elision: "L'échange", "d'bonheur". Only a small hint, since US places have it too
// (L'Anse, Coeur d'Alene).
const elision = /(?<!\p{L})(l|d|qu|j|n)['’]\p{L}/gu;

// Common in Spanish/Portuguese meeting names but also in US place names ("El Camino Real"),
// so they only add to the score.
const likelyForeign = [
  "esperanza", "esperança", "libertad", "liberdade", "limpios", "limpos", "passos", "pasos", "nueva",
  "nuevo", "vida", "camino", "caminho", "amanecer", "milagro", "mensaje", "unidos", "tradição",
  "tradicion", "tradición", "recomeço", "partilha", "relacionamentos", "sexo",
];

const foreignFunctionWords = new Set([
  "el", "la", "los", "las", "del", "y", "con", "para", "por", "una", "uno", "lo", "do", "da", "dos",
  "das", "em", "um", "uma", "nos", "ao", "et", "le", "les", "du", "des", "au", "aux", "une",
  "der", "die", "und", "im", "mit", "am", "zum", "il", "di", "che", "per", "och", "på", "med", "van",
  "het", "een", "op", "voor", "ème", "eme", "un",
  "de", "en", "es", "os", "ni", "que", "qui", "von", "den", "dem", "ein", "eine", "ins", "auf", "aus",
  "bei", "zur", "vom", "ist", "wir", "auch", "nicht", "hier",
]);

const englishWords = new Set([
  "the", "of", "and", "in", "for", "to", "a", "at", "on", "with", "by", "from", "is", "it", "we", "our", "i",
  "english", "speaking", "international", "no", "not", "matter", "rule", "real",
  "my", "you", "your", "how", "what", "why", "this", "that", "recovery", "or",
  "clean", "living", "hope", "serenity", "step", "steps", "tradition", "traditions", "women", "womens",
  "men", "mens", "new", "life", "just", "today", "day", "daily", "night", "morning", "evening", "noon",
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "weekend", "way",
  "spiritual", "awakening", "happy", "unity", "freedom", "miracle", "miracles", "together", "gratitude",
  "newcomer", "newcomers", "basic", "text", "literature", "study", "speaker", "home", "love", "live",
  "sober", "sobriety", "big", "book", "candlelight", "discussion", "topic", "open", "closed", "only",
  "beginners", "back", "basics", "works", "came", "believe", "surrender", "acceptance", "courage",
  "faith", "trust", "peace", "light", "lunch", "breakfast", "coffee", "keep", "coming", "first",
  "second", "third", "last", "good", "time", "times", "free", "help", "share", "sharing", "sangha",
  "dharma", "refuge", "mindful", "meditation", "inquiry", "circle", "wise", "heart", "people", "young",
  "gras", // "Mardi Gras Group" is English; "Mardi Gars" in Paris isn't
]);

// English words that German, Swedish and Italian meeting names borrow ("Frauenmeeting auf Zoom",
// "Bruxelles Online Group"). They count as English only outside the foreign home zones below.
const borrowedWords = new Set(["group", "meeting", "meetings", "online"]);

// Home time zones where most meetings are held in a language other than English.
const foreignZones = new Set([
  "America/Sao_Paulo", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Belem",
  "America/Manaus", "America/Mexico_City", "America/Monterrey", "America/Tijuana", "America/Bogota",
  "America/Lima", "America/Santiago", "America/Caracas", "America/Montevideo", "America/Asuncion",
  "America/La_Paz", "America/Guayaquil", "America/Guatemala", "America/El_Salvador",
  "America/Tegucigalpa", "America/Managua", "America/Costa_Rica", "America/Panama",
  "America/Santo_Domingo", "America/Havana", "America/Montreal", "Europe/Madrid", "Europe/Lisbon",
  "Europe/Paris", "Europe/Berlin", "Europe/Rome", "Europe/Vienna", "Europe/Zurich", "Europe/Brussels",
  "Europe/Amsterdam", "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen", "Europe/Helsinki",
  "Europe/Warsaw", "Europe/Prague", "Europe/Budapest", "Europe/Bucharest", "Europe/Athens",
  "Europe/Moscow", "Europe/Kiev", "Europe/Kyiv", "Asia/Tehran", "Asia/Tokyo", "Asia/Seoul",
  "Asia/Shanghai", "Asia/Bangkok", "Asia/Jerusalem", "Asia/Tel_Aviv", "Asia/Dhaka", "Asia/Jakarta",
  "Asia/Kathmandu",
]);

const stripAccents = (s) => s.normalize("NFD").replace(/\p{M}+/gu, "");
const likelyForeignPlain = new Set(likelyForeign.map(stripAccents));

const strongDiacritics = new Set(["ñ", "ã", "õ", "ç", "ß", "å", "ø", "æ", "œ"]);
const diacritics = new Set(["é", "è", "ê", "à", "â", "á", "í", "ó", "ú", "ü", "ö", "ä", "ô", "î", "ï", "ë"]);

/** True when the name (and home time zone) clearly point to a language other than English. */
export function looksNonEnglish(name, timeZone) {
  const letters = [...name].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return false;
  // Mostly Cyrillic, Arabic/Farsi, Hebrew, CJK, Thai, Devanagari...
  const nonLatin = letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
  if (nonLatin * 2 >= letters.length) return true;

  const lower = name.toLowerCase();
  const words = lower.split(/[^\p{L}]+/u).filter(Boolean);
  const plain = words.map(stripAccents);
  const abroad = foreignZones.has(timeZone);
  const english = words.filter((w) => englishWords.has(w) || (!abroad && borrowedWords.has(w))).length;
  if (words.includes("english") || words.includes("bilingual") || words.includes("bilingüe")) return false;
  if (namedLanguage.test(lower)) return true;

  if (words.some((w) => strongForeign.has(w)) || plain.some((w) => strongForeign.has(w)) || interpunct.test(lower)) {
    return english < 3;
  }
  let score = 0;
  if (nonLatin >= 3) score += 2; // a transliterated name next to the original
  if ([...lower].some((c) => strongDiacritics.has(c))) score += 2;
  if ([...lower].some((c) => diacritics.has(c))) score += 1;
  score += words.filter((w) => foreignFunctionWords.has(w)).length;
  score += 2 * plain.filter((w) => likelyForeignPlain.has(w) || foreignWords.has(w)).length;
  score += 3 * plain.filter((w) => foreignDays.has(w)).length;
  // German runs words together: "Frauenmeeting", "Donnerstag NAchtmeeting"; Swedish "Femtegruppen".
  score += 2 * plain.filter((w) => (w.endsWith("meeting") && w !== "meeting") || w.endsWith("gruppen")).length;
  if (name.includes("¿") || name.includes("¡")) score += 2;
  score += [...lower.matchAll(elision)].length;
  // A home time zone like Berlin is a hint, never enough alone.
  if (abroad) score += 1;
  return english === 0 ? score >= 2 : score >= 4 && score > english * 2;
}
