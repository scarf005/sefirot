export const readProgress = (
  ids: readonly string[],
  readIds: ReadonlySet<string>,
) => ({ read: ids.filter((id) => readIds.has(id)).length, total: ids.length })

export const nextUnreadId = (
  ids: readonly string[],
  readIds: ReadonlySet<string>,
) => ids.find((id) => !readIds.has(id))

// A selection that is not visible (filtered out) moves to the first visible
// story in either direction; the ends of the list stay put.
export const adjacentVisibleId = (
  visibleIds: readonly string[],
  currentId: string,
  step: 1 | -1,
) => {
  const index = visibleIds.indexOf(currentId)
  if (index < 0) return visibleIds[0]
  return visibleIds[Math.min(Math.max(index + step, 0), visibleIds.length - 1)]
}

export const selectionAfterFilter = (
  visibleIds: readonly string[],
  currentId: string,
) => visibleIds.includes(currentId) ? currentId : visibleIds[0] ?? currentId
