export type LaneFilter = {
  focused: string | null
  hidden: ReadonlySet<string>
}

const without = (ids: ReadonlySet<string>, id: string) =>
  new Set([...ids].filter((other) => other !== id))

// A lane heading click cycles: shown -> focused -> hidden -> shown.
export const cycleLane = (filter: LaneFilter, id: string): LaneFilter => {
  if (filter.focused === id) {
    return { focused: null, hidden: new Set([...filter.hidden, id]) }
  }
  if (filter.hidden.has(id)) {
    return { focused: filter.focused, hidden: without(filter.hidden, id) }
  }
  return { focused: id, hidden: without(filter.hidden, id) }
}

// A focused lane leaves only itself and the main story open.
export const collapsedLanes = (
  filter: LaneFilter,
  laneIds: string[],
): ReadonlySet<string> =>
  filter.focused
    ? new Set(
      laneIds.filter((id) => id !== filter.focused && id !== "main"),
    )
    : filter.hidden
