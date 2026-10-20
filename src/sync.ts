// Three-way merge used for Firestore sync.
//
// base   = the last cloud state this client knows about
// local  = what this client currently shows (base + unsynced local edits)
// remote = the newest cloud state
//
// Rules:
// - A side that did not change relative to base yields to the other side.
// - Plain objects merge key by key (keys deleted on one side stay deleted).
// - Arrays whose items all have an `id` merge item by item; a deleted item never
//   comes back, even if the other side still has an older copy of it.
// - Arrays of primitives merge as sets (additions and deletions from both sides).
// - True conflicts on the same primitive keep the local value.

type PlainObject = Record<string, unknown>

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) {
    return true
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    // Keys holding `undefined` are treated as missing, since Firestore drops them.
    const aKeys = Object.keys(a).filter((key) => a[key] !== undefined)
    const bKeys = Object.keys(b).filter((key) => b[key] !== undefined)
    return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(a[key], b[key]))
  }

  return false
}

const hasValue = (obj: PlainObject, key: string): boolean => obj[key] !== undefined

const isIdItem = (value: unknown): value is PlainObject & { id: string | number } =>
  isPlainObject(value) && (typeof value.id === 'number' || typeof value.id === 'string')

const isPrimitive = (value: unknown): boolean => value === null || typeof value !== 'object'

const mergeObjects = (base: unknown, local: PlainObject, remote: PlainObject): PlainObject => {
  const baseObj = isPlainObject(base) ? base : {}
  const result: PlainObject = {}
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])

  keys.forEach((key) => {
    const inLocal = hasValue(local, key)
    const inRemote = hasValue(remote, key)
    const inBase = hasValue(baseObj, key)

    if (inLocal && inRemote) {
      result[key] = mergeValues(baseObj[key], local[key], remote[key])
      return
    }

    if (inLocal) {
      // Remote deleted a key that local did not touch: honor the deletion.
      if (inBase && deepEqual(local[key], baseObj[key])) {
        return
      }
      result[key] = local[key]
      return
    }

    if (inRemote) {
      if (inBase && deepEqual(remote[key], baseObj[key])) {
        return
      }
      result[key] = remote[key]
    }
  })

  return result
}

const mergeIdArrays = (base: unknown[], local: unknown[], remote: unknown[]): unknown[] => {
  const toMap = (items: unknown[]) =>
    new Map(items.filter(isIdItem).map((item) => [String(item.id), item]))
  const baseById = toMap(base)
  const localById = toMap(local)
  const result: unknown[] = []
  const seen = new Set<string>()

  remote.forEach((remoteItem) => {
    if (!isIdItem(remoteItem)) {
      return
    }

    const id = String(remoteItem.id)
    seen.add(id)
    const localItem = localById.get(id)

    if (localItem) {
      result.push(mergeValues(baseById.get(id), localItem, remoteItem))
      return
    }

    // Missing locally but known in base means it was deleted locally: keep it deleted.
    if (!baseById.has(id)) {
      result.push(remoteItem)
    }
  })

  local.forEach((localItem) => {
    if (!isIdItem(localItem)) {
      return
    }

    const id = String(localItem.id)
    // Missing remotely but known in base means another client deleted it.
    if (seen.has(id) || baseById.has(id)) {
      return
    }
    result.push(localItem)
  })

  return result
}

const mergePrimitiveArrays = (base: unknown[], local: unknown[], remote: unknown[]): unknown[] => {
  const baseSet = new Set(base)
  const localSet = new Set(local)
  const remoteSet = new Set(remote)
  const result = remote.filter((value) => localSet.has(value) || !baseSet.has(value))
  local.forEach((value) => {
    if (!remoteSet.has(value) && !baseSet.has(value) && !result.includes(value)) {
      result.push(value)
    }
  })
  return result
}

export const mergeValues = (base: unknown, local: unknown, remote: unknown): unknown => {
  if (deepEqual(local, remote)) {
    return local
  }
  if (deepEqual(local, base)) {
    return remote
  }
  if (deepEqual(remote, base)) {
    return local
  }

  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjects(base, local, remote)
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const baseArr = Array.isArray(base) ? base : []
    const all = [...baseArr, ...local, ...remote]

    if (all.every(isIdItem)) {
      return mergeIdArrays(baseArr, local, remote)
    }

    if (all.every(isPrimitive)) {
      return mergePrimitiveArrays(baseArr, local, remote)
    }
  }

  return local
}

export const threeWayMerge = <T>(base: T, local: T, remote: T): T => mergeValues(base, local, remote) as T

// Firestore rejects `undefined` field values; drop them before writing.
export const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
