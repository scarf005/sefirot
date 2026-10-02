const hangul = /[ᄀ-ᇿ㄰-㆏가-힣]/gu
const kana = /[぀-ヿㇰ-ㇿ]/u
const letter = /\p{L}/gu

const count = (text: string, pattern: RegExp) =>
  text.match(pattern)?.length ?? 0

// Korean prose may quote a Japanese title, but Hangul must dominate and no
// sentence may be written in kana alone.
export const isKoreanText = (text: string) => {
  const letters = count(text, letter)
  if (letters === 0 || count(text, hangul) * 2 <= letters) return false
  return text.split(/[.!?。！？\n]+/u).every((sentence) =>
    !kana.test(sentence) || count(sentence, hangul) > 0
  )
}
