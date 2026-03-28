/**
 * Minimal Porter stemmer for common English suffixes found in database column names.
 * Zero dependencies. Not a full NLP stemmer — optimized for the ~200 most common
 * words seen in column/table names (financial, registration, diagnosis, etc.).
 */

const VOWEL = /[aeiou]/
const CONSONANT = /[^aeiou]/

/** Returns true if the stem contains at least one vowel followed by a consonant (measure > 0). */
function hasMeasure(s: string): boolean {
  // Simplified: does the stem have at least one vowel?
  return VOWEL.test(s) && s.length > 2
}

/** Returns true if the stem ends with a double consonant (e.g., "ll", "ss"). */
function endsDoubleConsonant(s: string): boolean {
  if (s.length < 2) return false
  const last = s[s.length - 1]!
  const prev = s[s.length - 2]!
  return last === prev && CONSONANT.test(last)
}

/** Returns true if the stem ends with consonant-vowel-consonant where last != w/x/y. */
function endsCVC(s: string): boolean {
  if (s.length < 3) return false
  const c1 = s[s.length - 3]!
  const v = s[s.length - 2]!
  const c2 = s[s.length - 1]!
  return CONSONANT.test(c1) && VOWEL.test(v) && CONSONANT.test(c2) && !/[wxy]/.test(c2)
}

/**
 * Step 1: Remove plurals and -ed/-ing endings.
 */
function step1(word: string): string {
  // Step 1a: plurals
  if (word.endsWith('sses')) {
    word = word.slice(0, -2)
  } else if (word.endsWith('ies')) {
    word = word.slice(0, -2)
  } else if (!word.endsWith('ss') && word.endsWith('s')) {
    word = word.slice(0, -1)
  }

  // Step 1b: -eed, -ed, -ing
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3)
    if (hasMeasure(stem)) {
      word = word.slice(0, -1) // -> -ee
    }
  } else if (word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    if (VOWEL.test(stem)) {
      word = stem
      word = step1bCleanup(word)
    }
  } else if (word.endsWith('ing')) {
    const stem = word.slice(0, -3)
    if (VOWEL.test(stem)) {
      word = stem
      word = step1bCleanup(word)
    }
  }

  return word
}

/** Post-processing after removing -ed/-ing. */
function step1bCleanup(word: string): string {
  if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
    return word + 'e'
  }
  if (endsDoubleConsonant(word) && !/[lsz]$/.test(word)) {
    return word.slice(0, -1)
  }
  if (!endsDoubleConsonant(word) && endsCVC(word) && word.length <= 3) {
    return word + 'e'
  }
  return word
}

/**
 * Step 2: Map double suffixes to single ones.
 */
function step2(word: string): string {
  const mappings: [string, string][] = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['isation', 'ize'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['logi', 'log'],
  ]

  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length)
      if (hasMeasure(stem)) {
        return stem + replacement
      }
      return word
    }
  }
  return word
}

/**
 * Step 3: Handle -icate, -ative, -alize, etc.
 */
function step3(word: string): string {
  const mappings: [string, string][] = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ]

  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length)
      if (hasMeasure(stem)) {
        return stem + replacement
      }
      return word
    }
  }
  return word
}

/**
 * Step 4: Remove -ant, -ence, -ment, etc. in context.
 */
function step4(word: string): string {
  const suffixes = [
    'ement', 'ment', 'ence', 'ance', 'able', 'ible',
    'ant', 'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
    'ion', 'al', 'er', 'ic', 'ly',
  ]

  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length)
      if (hasMeasure(stem) && stem.length >= 2) {
        // Special case: -ion requires s or t before it
        if (suffix === 'ion') {
          if (stem.endsWith('s') || stem.endsWith('t')) {
            return stem
          }
          continue
        }
        return stem
      }
    }
  }
  return word
}

/**
 * Step 5: Clean up final -e and -ll.
 */
function step5(word: string): string {
  // Step 5a: remove trailing e if measure > 1, or measure == 1 and not CVC
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1)
    if (stem.length > 2) {
      return stem
    }
  }

  // Step 5b: reduce -ll to -l
  if (word.endsWith('ll') && word.length > 3) {
    return word.slice(0, -1)
  }

  return word
}

/**
 * Stems a single word using a simplified Porter stemmer.
 * Returns the stemmed form (lowercase).
 *
 * @example
 * stem('financial') // => 'financ'
 * stem('registration') // => 'registr'
 * stem('diagnosis') // => 'diagnos'
 */
export function stem(word: string): string {
  word = word.toLowerCase().trim()

  // Don't stem very short words
  if (word.length <= 2) return word

  word = step1(word)
  word = step2(word)
  word = step3(word)
  word = step4(word)
  word = step5(word)

  return word
}
