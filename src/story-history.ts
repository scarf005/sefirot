export type StoryHistoryStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>

export const storyHistoryStorageKey = "sefirot.story-history.v1"

const validStoryIds = (
  ids: Iterable<string>,
  validIds?: ReadonlySet<string>,
) => {
  const uniqueIds: string[] = []
  const seenIds = new Set<string>()
  for (const id of ids) {
    if (seenIds.has(id) || (validIds && !validIds.has(id))) continue
    seenIds.add(id)
    uniqueIds.push(id)
  }
  return uniqueIds
}

const storyIdsFromValue = (value: unknown) => {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") {
    const history = value as Record<string, unknown>
    if (Array.isArray(history.readItemIds)) return history.readItemIds
  }
  throw new Error("Invalid story history")
}

const stringStoryIds = (value: unknown) => {
  const ids = storyIdsFromValue(value)
  if (!ids.every((id) => typeof id === "string")) {
    throw new Error("Invalid story history IDs")
  }
  return ids
}

export const parseStoryHistory = (
  source: string,
  validIds?: ReadonlySet<string>,
) => new Set(validStoryIds(stringStoryIds(JSON.parse(source)), validIds))

export const serializeStoryHistory = (readItemIds: Iterable<string>) => {
  return `${
    JSON.stringify({ readItemIds: [...new Set(readItemIds)].sort() }, null, 2)
  }\n`
}

export const loadStoryHistory = ({
  storage,
  validIds,
}: {
  storage: Pick<StoryHistoryStorage, "getItem">
  validIds?: ReadonlySet<string>
}) => {
  const stored = storage.getItem(storyHistoryStorageKey)
  if (!stored) return new Set<string>()
  return parseStoryHistory(stored, validIds)
}

export const saveStoryHistory = ({
  storage,
  readItemIds,
}: {
  storage: Pick<StoryHistoryStorage, "setItem">
  readItemIds: Iterable<string>
}) => {
  storage.setItem(storyHistoryStorageKey, serializeStoryHistory(readItemIds))
}

export const eraseStoryHistory = ({
  storage,
}: {
  storage: Pick<StoryHistoryStorage, "removeItem">
}) => {
  storage.removeItem(storyHistoryStorageKey)
}
