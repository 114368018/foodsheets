import { useMemo, useState } from 'react'
import { formatQtyNumber, formatQuantity, normalizeNameKey, parseQuantity } from '../item-input'

export type ShoppingStoreItem = {
  id: number
  ingredient: string
  price: string
  ownedQty?: string
  purchased?: boolean
}

export type ShoppingStore = {
  id: number
  storeName: string
  items: ShoppingStoreItem[]
}

export type ShoppingNeed = {
  key: string
  name: string
  /** e.g. "5 顆 + 300 g" or "適量" */
  display: string
  /** Set when the need is a single measurable quantity, so "家中已有" can be subtracted. */
  single: { qty: number; unit: string } | null
  note: string
  sources: string[]
  hasMissingQty: boolean
}

type ShoppingBoardProps = {
  needs: ShoppingNeed[]
  stores: ShoppingStore[]
  setStores: (updater: (previous: ShoppingStore[]) => ShoppingStore[]) => void
  onNotice: (message: string, undo?: () => void) => void
  createId: () => number
}

type View = 'unassigned' | 'all' | number

const STORE_PRESETS = ['全聯', '家樂福', '傳統市場', 'Costco', '大創']

const toNumber = (value: string | undefined) => parseQuantity(value ?? '') ?? 0

function ShoppingBoard({ needs, stores, setStores, onNotice, createId }: ShoppingBoardProps) {
  const [view, setView] = useState<View>('unassigned')
  const [query, setQuery] = useState('')
  const [newStoreName, setNewStoreName] = useState('')
  const [bulkTargetStoreId, setBulkTargetStoreId] = useState<number | ''>('')
  const [showPurchased, setShowPurchased] = useState(true)

  const needByKey = useMemo(() => new Map(needs.map((need) => [need.key, need])), [needs])

  // First store that lists an ingredient wins; duplicates from older versions are cleaned up on reassign.
  const assignmentByKey = useMemo(() => {
    const map = new Map<string, { store: ShoppingStore; item: ShoppingStoreItem }>()
    stores.forEach((store) => {
      store.items.forEach((item) => {
        const key = normalizeNameKey(item.ingredient)
        if (key && !map.has(key)) {
          map.set(key, { store, item })
        }
      })
    })
    return map
  }, [stores])

  const orphanItems = useMemo(
    () =>
      stores.flatMap((store) =>
        store.items
          .filter((item) => !needByKey.has(normalizeNameKey(item.ingredient)))
          .map((item) => ({ store, item })),
      ),
    [needByKey, stores],
  )

  const remainingFor = (need: ShoppingNeed, item: ShoppingStoreItem | undefined) => {
    if (!need.single) {
      return null
    }
    return Math.max(need.single.qty - toNumber(item?.ownedQty), 0)
  }

  const isDone = (need: ShoppingNeed) => {
    const assignment = assignmentByKey.get(need.key)
    if (assignment?.item.purchased) {
      return true
    }
    const remaining = remainingFor(need, assignment?.item)
    return remaining !== null && remaining === 0 && toNumber(assignment?.item.ownedQty) > 0
  }

  const doneCount = needs.filter(isDone).length
  const unassignedNeeds = needs.filter((need) => !assignmentByKey.has(need.key))
  const totalSpent = stores.reduce(
    (sum, store) => sum + store.items.reduce((storeSum, item) => storeSum + toNumber(item.price), 0),
    0,
  )
  const progress = needs.length > 0 ? Math.round((doneCount / needs.length) * 100) : 0

  const activeStore = typeof view === 'number' ? stores.find((store) => store.id === view) ?? null : null
  const currentView: View = typeof view === 'number' && !activeStore ? 'unassigned' : view

  const matchesQuery = (need: ShoppingNeed) => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return true
    }
    return [need.name, need.note, ...need.sources].join(' ').toLowerCase().includes(keyword)
  }

  const listedNeeds = (() => {
    if (currentView === 'unassigned') {
      return unassignedNeeds.filter(matchesQuery)
    }
    if (currentView === 'all') {
      return needs.filter(matchesQuery)
    }
    return needs.filter((need) => assignmentByKey.get(need.key)?.store.id === currentView && matchesQuery(need))
  })()

  const pendingNeeds = listedNeeds.filter((need) => !isDone(need))
  const doneNeeds = listedNeeds.filter(isDone)

  // --- mutations ---

  const assignNeed = (need: ShoppingNeed, storeId: number | null) => {
    setStores((previous) => {
      let carried: ShoppingStoreItem | null = null
      const cleaned = previous.map((store) => {
        const kept = store.items.filter((item) => {
          const same = normalizeNameKey(item.ingredient) === need.key
          if (same && !carried) {
            carried = item
          }
          return !same
        })
        return kept.length === store.items.length ? store : { ...store, items: kept }
      })

      if (storeId === null) {
        return cleaned
      }

      const base: ShoppingStoreItem = carried ?? { id: createId(), ingredient: need.name, price: '', ownedQty: '' }
      return cleaned.map((store) =>
        store.id === storeId ? { ...store, items: [...store.items, { ...base, ingredient: need.name }] } : store,
      )
    })
  }

  const assignMany = (targets: ShoppingNeed[], storeId: number) => {
    const store = stores.find((candidate) => candidate.id === storeId)
    if (!store || targets.length === 0) {
      return
    }
    const keys = new Set(targets.map((need) => need.key))
    setStores((previous) =>
      previous.map((candidate) => {
        if (candidate.id !== storeId) {
          return candidate
        }
        const existing = new Set(candidate.items.map((item) => normalizeNameKey(item.ingredient)))
        const additions = targets
          .filter((need) => keys.has(need.key) && !existing.has(need.key))
          .map((need) => ({ id: createId(), ingredient: need.name, price: '', ownedQty: '' }))
        return { ...candidate, items: [...candidate.items, ...additions] }
      }),
    )
    onNotice(`已把 ${targets.length} 項分配到「${store.storeName || '未命名商店'}」`)
  }

  const updateItem = (storeId: number, itemId: number, patch: Partial<ShoppingStoreItem>) => {
    setStores((previous) =>
      previous.map((store) =>
        store.id === storeId
          ? { ...store, items: store.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }
          : store,
      ),
    )
  }

  const removeItem = (storeId: number, itemId: number) => {
    setStores((previous) =>
      previous.map((store) =>
        store.id === storeId ? { ...store, items: store.items.filter((item) => item.id !== itemId) } : store,
      ),
    )
  }

  const addStore = (rawName: string) => {
    const name = rawName.trim()
    if (!name) {
      return
    }
    const id = createId()
    setStores((previous) => [...previous, { id, storeName: name, items: [] }])
    setNewStoreName('')
    if (bulkTargetStoreId === '') {
      setBulkTargetStoreId(id)
    }
  }

  const deleteStore = (store: ShoppingStore) => {
    const index = stores.findIndex((candidate) => candidate.id === store.id)
    setStores((previous) => previous.filter((candidate) => candidate.id !== store.id))
    setView('unassigned')
    onNotice(`已刪除「${store.storeName || '未命名商店'}」，裡面的 ${store.items.length} 項回到未分配`, () => {
      setStores((previous) => {
        const next = [...previous]
        next.splice(Math.min(index, next.length), 0, store)
        return next
      })
    })
  }

  const copyStoreList = async (store: ShoppingStore) => {
    const lines = needs
      .filter((need) => assignmentByKey.get(need.key)?.store.id === store.id && !isDone(need))
      .map((need) => {
        const remaining = remainingFor(need, assignmentByKey.get(need.key)?.item)
        const amount = need.single && remaining !== null ? formatQuantity(remaining, need.single.unit) : need.display
        return `☐ ${need.name} ${amount}${need.note ? `（${need.note}）` : ''}`
      })
    const text = [`【${store.storeName || '未命名商店'}】待買 ${lines.length} 項`, ...lines].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      onNotice('已複製清單，可以直接貼到 LINE 群組')
    } catch {
      window.prompt('複製失敗，請手動複製以下內容：', text)
    }
  }

  // --- rendering ---

  const storeLabel = (store: ShoppingStore) => store.storeName.trim() || '未命名商店'

  const storeCount = (storeId: number) =>
    needs.filter((need) => assignmentByKey.get(need.key)?.store.id === storeId).length

  const renderNeed = (need: ShoppingNeed) => {
    const assignment = assignmentByKey.get(need.key)
    const item = assignment?.item
    const done = isDone(need)
    const remaining = remainingFor(need, item)
    const owned = toNumber(item?.ownedQty)
    const amountText =
      need.single && remaining !== null && owned > 0
        ? remaining === 0
          ? '家中已足夠'
          : `還要買 ${formatQuantity(remaining, need.single.unit)}`
        : need.display

    return (
      <li key={need.key} className={`shop-card ${done ? 'is-done' : ''}`}>
        <div className="shop-card-main">
          {assignment ? (
            <input
              type="checkbox"
              className="shop-check"
              checked={Boolean(item?.purchased)}
              onChange={(event) => updateItem(assignment.store.id, assignment.item.id, { purchased: event.target.checked })}
              aria-label={`${need.name} 已購買`}
            />
          ) : (
            <span className="shop-check-placeholder" aria-hidden="true" />
          )}
          <div className="shop-card-body">
            <div className="shop-card-title">
              <strong>{need.name}</strong>
              <span className={`shop-amount ${need.hasMissingQty ? 'is-warning' : ''}`}>{amountText}</span>
            </div>
            <p className="shop-card-sub">
              {need.sources.join('・')}
              {need.hasMissingQty && <span className="shop-warn">（有組別未填數量）</span>}
            </p>
            {need.note && <p className="shop-card-note">備註：{need.note}</p>}
          </div>
        </div>

        {typeof currentView !== 'number' ? (
          <div className="shop-store-chips" role="group" aria-label={`${need.name} 要去哪裡買`}>
            {stores.length === 0 && <span className="shop-hint-inline">先在上方新增商店，就能一鍵分配</span>}
            {stores.map((store) => {
              const active = assignment?.store.id === store.id
              return (
                <button
                  key={store.id}
                  type="button"
                  className={`shop-chip ${active ? 'is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => assignNeed(need, active ? null : store.id)}
                >
                  {storeLabel(store)}
                </button>
              )
            })}
          </div>
        ) : (
          assignment && (
            <div className="shop-card-extra">
              {need.single && (
                <label className="shop-field">
                  家中已有
                  <span className="shop-field-input">
                    <input
                      inputMode="decimal"
                      value={item?.ownedQty ?? ''}
                      onChange={(event) =>
                        updateItem(assignment.store.id, assignment.item.id, { ownedQty: event.target.value })
                      }
                      placeholder="0"
                    />
                    <span>{need.single.unit}</span>
                  </span>
                </label>
              )}
              <label className="shop-field">
                花費
                <span className="shop-field-input">
                  <span>$</span>
                  <input
                    inputMode="numeric"
                    value={item?.price ?? ''}
                    onChange={(event) =>
                      updateItem(assignment.store.id, assignment.item.id, { price: event.target.value })
                    }
                    placeholder="0"
                  />
                </span>
              </label>
              <label className="shop-field">
                改到
                <select
                  value={assignment.store.id}
                  onChange={(event) => assignNeed(need, Number(event.target.value) || null)}
                >
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {storeLabel(store)}
                    </option>
                  ))}
                  <option value="">（移回未分配）</option>
                </select>
              </label>
            </div>
          )
        )}
      </li>
    )
  }

  const bulkStoreId = bulkTargetStoreId !== '' && stores.some((store) => store.id === bulkTargetStoreId)
    ? bulkTargetStoreId
    : stores[0]?.id

  return (
    <section className="panel shop">
      <header className="shop-header">
        <div>
          <h2>食材採買</h2>
          <p className="hint shop-header-hint">
            所有組別的食材已自動合併（kg／g、公升／ml 會換算）。先把食材分到商店，出門採買時點商店進入清單勾選。
          </p>
        </div>
        <div className="shop-stats">
          <div className="shop-stat">
            <span className="shop-stat-value">
              {doneCount}/{needs.length}
            </span>
            <span className="shop-stat-label">已買齊</span>
          </div>
          <div className="shop-stat">
            <span className="shop-stat-value">{unassignedNeeds.length}</span>
            <span className="shop-stat-label">未分配</span>
          </div>
          <div className="shop-stat">
            <span className="shop-stat-value">${formatQtyNumber(totalSpent)}</span>
            <span className="shop-stat-label">已花費</span>
          </div>
        </div>
      </header>
      <div className="shop-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="shop-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <nav className="shop-views" aria-label="採買檢視">
        <button
          type="button"
          className={`shop-view ${currentView === 'unassigned' ? 'is-active' : ''}`}
          onClick={() => setView('unassigned')}
        >
          未分配 <span className="shop-count">{unassignedNeeds.length}</span>
        </button>
        <button
          type="button"
          className={`shop-view ${currentView === 'all' ? 'is-active' : ''}`}
          onClick={() => setView('all')}
        >
          全部 <span className="shop-count">{needs.length}</span>
        </button>
        {stores.map((store) => (
          <button
            key={store.id}
            type="button"
            className={`shop-view shop-view-store ${currentView === store.id ? 'is-active' : ''}`}
            onClick={() => setView(store.id)}
          >
            🛒 {storeLabel(store)} <span className="shop-count">{storeCount(store.id)}</span>
          </button>
        ))}
        <form
          className="shop-add-store"
          onSubmit={(event) => {
            event.preventDefault()
            addStore(newStoreName)
          }}
        >
          <input
            value={newStoreName}
            onChange={(event) => setNewStoreName(event.target.value)}
            placeholder="新增商店…"
            aria-label="新增商店名稱"
          />
          <button type="submit" disabled={!newStoreName.trim()}>
            ＋
          </button>
        </form>
      </nav>

      {stores.length === 0 && (
        <div className="shop-presets">
          <span className="hint">快速新增：</span>
          {STORE_PRESETS.map((name) => (
            <button key={name} type="button" className="shop-chip" onClick={() => addStore(name)}>
              ＋ {name}
            </button>
          ))}
        </div>
      )}

      {activeStore && (
        <div className="shop-store-header">
          <input
            className="shop-store-name"
            value={activeStore.storeName}
            onChange={(event) =>
              setStores((previous) =>
                previous.map((store) =>
                  store.id === activeStore.id ? { ...store, storeName: event.target.value } : store,
                ),
              )
            }
            aria-label="商店名稱"
          />
          <span className="shop-store-total">
            小計 ${formatQtyNumber(activeStore.items.reduce((sum, item) => sum + toNumber(item.price), 0))}
          </span>
          <button type="button" className="btn-secondary" onClick={() => void copyStoreList(activeStore)}>
            複製待買清單
          </button>
          <button type="button" className="btn-danger-outline" onClick={() => deleteStore(activeStore)}>
            刪除商店
          </button>
        </div>
      )}

      <div className="shop-toolbar">
        <input
          className="shop-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋食材、組別或備註"
          aria-label="搜尋食材"
        />
        {currentView === 'unassigned' && stores.length > 0 && pendingNeeds.length > 0 && (
          <div className="shop-bulk">
            <span>把下面 {pendingNeeds.length} 項全部分到</span>
            <select
              value={bulkStoreId ?? ''}
              onChange={(event) => setBulkTargetStoreId(Number(event.target.value) || '')}
              aria-label="批次分配的商店"
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {storeLabel(store)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => bulkStoreId !== undefined && assignMany(pendingNeeds, bulkStoreId)}
            >
              分配
            </button>
          </div>
        )}
      </div>

      {needs.length === 0 ? (
        <p className="empty">各組還沒有填寫食材，填好後這裡會自動出現採買清單。</p>
      ) : listedNeeds.length === 0 ? (
        <p className="empty">
          {currentView === 'unassigned' && !query ? '🎉 全部食材都已分配到商店了！' : '沒有符合的食材。'}
        </p>
      ) : (
        <>
          <ul className="shop-list">{pendingNeeds.map(renderNeed)}</ul>
          {doneNeeds.length > 0 && (
            <div className="shop-done-section">
              <button
                type="button"
                className="shop-done-toggle"
                onClick={() => setShowPurchased((previous) => !previous)}
                aria-expanded={showPurchased}
              >
                {showPurchased ? '▾' : '▸'} 已買齊 {doneNeeds.length} 項
              </button>
              {showPurchased && <ul className="shop-list">{doneNeeds.map(renderNeed)}</ul>}
            </div>
          )}
        </>
      )}

      {orphanItems.length > 0 && (
        <div className="shop-orphans">
          <h3>⚠ 已不在任何組別清單中的項目</h3>
          <p className="hint">這些食材可能被組別刪除或改名了。已填的花費仍會計入總額，確認後可移除。</p>
          <ul>
            {orphanItems.map(({ store, item }) => (
              <li key={`${store.id}-${item.id}`}>
                <span>
                  {item.ingredient || '（未選擇食材）'}・{storeLabel(store)}
                  {item.price ? `・$${item.price}` : ''}
                </span>
                <button type="button" className="btn-danger-outline" onClick={() => removeItem(store.id, item.id)}>
                  移除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default ShoppingBoard
