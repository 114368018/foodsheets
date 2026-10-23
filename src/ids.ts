let lastId = 0

// Numeric ids for new rows, dishes, stores and items. Date.now() alone repeats when two things are
// created in the same millisecond (double clicks, "assign all", two users at once), which breaks
// id-based merging. Milliseconds × 1000 plus a random part stays unique and below 2^53.
export const nextId = (): number => {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000)
  lastId = candidate > lastId ? candidate : lastId + 1
  return lastId
}
