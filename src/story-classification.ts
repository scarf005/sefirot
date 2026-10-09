export type StoryItem = {
  id: string
  order: number
  segmentName: string
  kind: string
  series: string
  chapter: string
  episodes: string
  title: string
  label: string
  notes: string[]
}

export type Lane = { id: string; label: string }

export const lanes: Lane[] = [
  { id: "main", label: "메인 스토리" },
  { id: "hyakkiyako", label: "백귀야행" },
  { id: "abydos", label: "아비도스" },
  { id: "gehenna", label: "게헨나" },
  { id: "millennium", label: "밀레니엄" },
  { id: "trinity", label: "트리니티" },
  { id: "red-winter", label: "붉은겨울" },
  { id: "shanhaijing", label: "산해경" },
  { id: "valkyrie", label: "발키리/SRT" },
  { id: "highlander", label: "하이랜더" },
  { id: "wildhunt", label: "와일드헌트" },
  { id: "other", label: "기타/콜라보" },
]

const laneById = new Map(lanes.map((lane) => [lane.id, lane]))

const textOf = (item: StoryItem) => {
  return `${item.series} ${item.chapter} ${item.title} ${item.label} ${
    item.notes.join(" ")
  }`
}

const includesAny = (text: string, keywords: string[]) => {
  return keywords.some((keyword) => text.includes(keyword))
}

export const laneForItem = (item: StoryItem) => {
  const text = textOf(item)
  if (
    item.kind === "메인" ||
    includesAny(text, [
      "메인 스토리 연계",
      "연합 작전: 거짓된 성소",
      "아트라하시스",
      "복구 작업: D.U.",
      "강철대륙",
      "말쿠트",
      "데카그라마톤 결전",
    ])
  ) return laneById.get("main")!
  if (
    includesAny(text, [
      "산해경",
      "네버랜드",
      "매화원",
      "용무동주",
      "현룡문",
      "오욕내강",
      "월화몽소",
    ])
  ) return laneById.get("shanhaijing")!
  if (includesAny(text, ["붉은겨울", "227", "이반 쿠팔라", "테르마이"])) {
    return laneById.get("red-winter")!
  }
  if (
    includesAny(text, [
      "발키리",
      "생활안전국",
      "RABBIT",
      "여름특수작전",
      "Say-Bing",
    ])
  ) return laneById.get("valkyrie")!
  if (includesAny(text, ["하이랜더", "Pray-Ball"])) {
    return laneById.get("highlander")!
  }
  if (
    includesAny(text, [
      "와일드헌트",
      "오컬트",
      "누구를 위한 예술",
      "위작",
      "사감대",
    ])
  ) return laneById.get("wildhunt")!
  if (
    includesAny(text, [
      "백귀야행",
      "벚꽃",
      "마츠리",
      "수행부",
      "인법",
      "불인",
      "음양부",
      "와글와글",
      "백에서 피어난",
    ])
  ) return laneById.get("hyakkiyako")!
  if (includesAny(text, ["아비도스", "대책위원회", "Sheside", "아페리티프"])) {
    return laneById.get("abydos")!
  }
  if (
    includesAny(text, [
      "게헨나",
      "미식",
      "흥신소",
      "급양",
      "선도부",
      "히나",
      "만마전",
      "온천",
      "0068",
      "Serenade",
      "미드나잇",
      "팬데믹",
      "신춘광상곡",
    ])
  ) return laneById.get("gehenna")!
  if (
    includesAny(text, [
      "밀레니엄",
      "엔지니어",
      "게임개발",
      "Cleaning",
      "C&C",
      "바니 체이서",
      "순백의 예고장",
      "베리타스",
      "세미나",
      "트레이닝부",
      "황륜",
      "전뇌",
      "Code: BOX",
      "동인",
      "프레나파테스",
    ])
  ) return laneById.get("millennium")!
  if (
    includesAny(text, [
      "트리니티",
      "구호",
      "정의",
      "디저트",
      "수녀",
      "고서관",
      "성당",
      "위시리스트",
      "티파티",
      "르네상스",
    ])
  ) return laneById.get("trinity")!
  return laneById.get("other")!
}

export const nodeSize = (item: StoryItem) => {
  if (item.kind === "메인") return { width: 260, height: 112 }
  if (item.kind === "이벤트") return { width: 168, height: 84 }
  return { width: 148, height: 64 }
}

// Importance comes from the namu wiki note, e.g. "중요도: 하 | ...".
export const importanceOf = (item: StoryItem) =>
  item.notes.join(" ").match(/중요도:\s*(상|중하|중|하|없음)/)?.[1]

// Unmarked stories are not judged, so only explicit low marks are minor.
export const isMinorStory = (item: StoryItem) =>
  ["하", "중하", "없음"].includes(importanceOf(item) ?? "")
