import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  EXTRA_UNIT_OPTIONS,
  VAGUE_QTY,
  formatQtyNumber,
  normalizeNameKey,
  parseItemLine,
  parseQuantity,
  toBaseUnit,
  type ItemDraft,
} from '../item-input'

export type QuickListItem = {
  id: number
  name: string
  qty: string
  unit: string
  note: string
}

type ItemPatch = Partial<Omit<QuickListItem, 'id'>>

type ItemQuickListProps = {
  kind: 'ingredient' | 'tool'
  items: QuickListItem[]
  library: string[]
  unitChips: string[]
  suggestUnit: (name: string) => string
  readOnly?: boolean
  /** Appends new rows and returns their ids in the same order. */
  onCreate: (drafts: ItemDraft[]) => number[]
  onChange: (id: number, patch: ItemPatch) => void
  onRemove: (id: number) => void
  onNotice?: (message: string) => void
}

const MAX_SUGGESTIONS = 8

const COPY = {
  ingredient: {
    noun: '食材',
    placeholder: '輸入食材，例如「洋蔥 2顆」「鹽 適量」，按 Enter 加入',
    bulkPlaceholder: '每行一項，可直接貼上食譜的食材清單，例如：\n洋蔥 2顆\n雞蛋 6顆\n醬油 1瓶\n鹽 適量',
    empty: '還沒有食材。在上方輸入框打字就能加入，例如「洋蔥 2顆」。',
  },
  tool: {
    noun: '工具',
    placeholder: '輸入工具，例如「平底鍋 1」「砧板 2個」，按 Enter 加入',
    bulkPlaceholder: '每行一項，例如：\n平底鍋 1\n砧板 2個\n打蛋器 1',
    empty: '還沒有工具。在上方輸入框打字就能加入，例如「平底鍋 1」。',
  },
} as const

const unitsCompatible = (a: string, b: string) => !a || !b || toBaseUnit(a).base === toBaseUnit(b).base

/** Adds two quantities in the unit of the first one; returns null when they cannot be summed. */
const sumQuantities = (qtyA: string, unitA: string, qtyB: string, unitB: string): string | null => {
  const a = parseQuantity(qtyA)
  const b = parseQuantity(qtyB)
  if (a === null || b === null || !unitsCompatible(unitA, unitB)) {
    return null
  }
  const factorA = toBaseUnit(unitA || unitB).factor
  const factorB = toBaseUnit(unitB || unitA).factor
  return formatQtyNumber(a + (b * factorB) / factorA)
}

function ItemQuickList({
  kind,
  items,
  library,
  unitChips,
  suggestUnit,
  readOnly = false,
  onCreate,
  onChange,
  onRemove,
  onNotice,
}: ItemQuickListProps) {
  const copy = COPY[kind]
  const baseId = useId()
  const unitListId = `${baseId}-units`
  const [draftText, setDraftText] = useState('')
  const [unitOverride, setUnitOverride] = useState('')
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [editingNameId, setEditingNameId] = useState<number | null>(null)
  const [openNoteIds, setOpenNoteIds] = useState<Record<number, boolean>>({})
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null)
  const draftInputRef = useRef<HTMLInputElement>(null)
  const qtyInputRefs = useRef(new Map<number, HTMLInputElement>())

  const parsedDraft = useMemo(() => parseItemLine(draftText, library), [draftText, library])

  const effectiveUnit = (draft: ItemDraft) => {
    if (draft.unit) {
      return draft.unit
    }
    if (draft.qty === VAGUE_QTY) {
      return ''
    }
    return suggestUnit(draft.name)
  }

  const previewUnit = parsedDraft ? unitOverride || effectiveUnit(parsedDraft) : ''

  const suggestions = useMemo(() => {
    const query = normalizeNameKey(parsedDraft?.name ?? draftText)
    if (!query || /\d/.test(draftText)) {
      return []
    }

    const startsWith: string[] = []
    const contains: string[] = []
    library.forEach((name) => {
      const key = normalizeNameKey(name)
      if (key === query) {
        return
      }
      if (key.startsWith(query)) {
        startsWith.push(name)
      } else if (key.includes(query)) {
        contains.push(name)
      }
    })
    return [...startsWith, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [draftText, library, parsedDraft])

  const showSuggestions = suggestionsOpen && suggestions.length > 0

  const existingKeys = useMemo(() => new Set(items.map((item) => normalizeNameKey(item.name))), [items])

  useEffect(() => {
    if (pendingFocusId === null) {
      return
    }
    const input = qtyInputRefs.current.get(pendingFocusId)
    if (input) {
      input.focus()
      input.select()
      setPendingFocusId(null)
    }
  }, [items, pendingFocusId])

  /** Merges drafts into existing rows when the name and unit match, otherwise creates rows. */
  const commitDrafts = (drafts: ItemDraft[]) => {
    const toCreate: ItemDraft[] = []
    const merged: string[] = []
    let focusTarget: { existingId?: number; createIndex?: number } | null = null

    drafts.forEach((draft) => {
      const key = normalizeNameKey(draft.name)
      const existing = items.find(
        (item) => normalizeNameKey(item.name) === key && unitsCompatible(item.unit, draft.unit),
      )
      const pendingSame = toCreate.find(
        (candidate) => normalizeNameKey(candidate.name) === key && unitsCompatible(candidate.unit, draft.unit),
      )

      if (existing) {
        const total = existing.qty.trim() ? sumQuantities(existing.qty, existing.unit, draft.qty, draft.unit) : draft.qty
        if (total !== null) {
          onChange(existing.id, {
            qty: total,
            unit: existing.unit || draft.unit,
            note: [existing.note, draft.note].filter(Boolean).join('，'),
          })
          if (total) {
            merged.push(`${existing.name} 共 ${total}${existing.unit || draft.unit ? ` ${existing.unit || draft.unit}` : ''}`)
          } else if (!focusTarget) {
            focusTarget = { existingId: existing.id }
          }
          return
        }
      }

      if (pendingSame) {
        const total = sumQuantities(pendingSame.qty, pendingSame.unit, draft.qty, draft.unit)
        if (total !== null) {
          pendingSame.qty = total
          return
        }
      }

      toCreate.push({ ...draft })
      if (!draft.qty && !focusTarget) {
        focusTarget = { createIndex: toCreate.length - 1 }
      }
    })

    const createdIds = toCreate.length > 0 ? onCreate(toCreate) : []
    const target = focusTarget as { existingId?: number; createIndex?: number } | null
    if (target?.existingId !== undefined) {
      setPendingFocusId(target.existingId)
    } else if (target?.createIndex !== undefined && createdIds[target.createIndex] !== undefined) {
      setPendingFocusId(createdIds[target.createIndex])
    }

    if (merged.length > 0) {
      onNotice?.(`已合併重複的${copy.noun}：${merged.join('、')}`)
    }

    return { focusesQty: Boolean(target) }
  }

  const addFromDraft = () => {
    if (!parsedDraft) {
      return
    }
    const { focusesQty } = commitDrafts([{ ...parsedDraft, unit: previewUnit }])
    setDraftText('')
    setUnitOverride('')
    setSuggestionsOpen(false)
    setHighlightIndex(-1)
    if (!focusesQty) {
      draftInputRef.current?.focus()
    }
  }

  const pickSuggestion = (name: string) => {
    const rest = parsedDraft && parsedDraft.qty ? ` ${parsedDraft.qty}${parsedDraft.unit}` : ' '
    setDraftText(`${name}${rest}`)
    setSuggestionsOpen(false)
    setHighlightIndex(-1)
    draftInputRef.current?.focus()
  }

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === 'ArrowDown' && showSuggestions) {
      event.preventDefault()
      setHighlightIndex((previous) => (previous + 1) % suggestions.length)
      return
    }

    if (event.key === 'ArrowUp' && showSuggestions) {
      event.preventDefault()
      setHighlightIndex((previous) => (previous <= 0 ? suggestions.length - 1 : previous - 1))
      return
    }

    if (event.key === 'Escape') {
      setSuggestionsOpen(false)
      setHighlightIndex(-1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (showSuggestions && highlightIndex >= 0) {
        pickSuggestion(suggestions[highlightIndex])
        return
      }
      addFromDraft()
    }
  }

  const bulkDrafts = useMemo(
    () =>
      bulkText
        .split(/\r?\n/)
        .map((line) => parseItemLine(line, library))
        .filter((draft): draft is ItemDraft => Boolean(draft))
        .map((draft) => ({ ...draft, unit: effectiveUnit(draft) })),
    // effectiveUnit only depends on suggestUnit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bulkText, library, suggestUnit],
  )

  const addBulk = () => {
    if (bulkDrafts.length === 0) {
      return
    }
    commitDrafts(bulkDrafts)
    onNotice?.(`已加入 ${bulkDrafts.length} 項${copy.noun}`)
    setBulkText('')
    setBulkOpen(false)
  }

  const stepQty = (item: QuickListItem, delta: number) => {
    const current = parseQuantity(item.qty)
    if (current === null && item.qty.trim()) {
      return
    }
    const next = Math.max((current ?? 0) + delta, 0)
    if (next <= 0) {
      return
    }
    onChange(item.id, { qty: formatQtyNumber(next) })
  }

  const unitOptions = useMemo(
    () => Array.from(new Set([...unitChips, ...EXTRA_UNIT_OPTIONS])),
    [unitChips],
  )

  if (readOnly) {
    return (
      <div className="ql">
        {items.length === 0 ? (
          <p className="ql-empty">（尚未填寫）</p>
        ) : (
          <ul className="ql-list ql-list-readonly">
            {items.map((item) => (
              <li key={item.id} className="ql-row">
                <span className="ql-name-text">{item.name || '（未命名）'}</span>
                <span className="ql-readonly-qty">
                  {item.qty || '—'} {item.unit}
                </span>
                {item.note && <span className="ql-note-text is-static">{item.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="ql">
      <datalist id={unitListId}>
        {unitOptions.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <div className="ql-composer">
        <div className="ql-input-row">
          <div className="ql-input-wrap">
            <input
              ref={draftInputRef}
              className="ql-draft-input"
              value={draftText}
              onChange={(event) => {
                setDraftText(event.target.value)
                setUnitOverride('')
                setSuggestionsOpen(true)
                setHighlightIndex(-1)
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
              onKeyDown={handleDraftKeyDown}
              placeholder={copy.placeholder}
              aria-label={`新增${copy.noun}`}
              role="combobox"
              aria-expanded={showSuggestions}
              aria-autocomplete="list"
              autoComplete="off"
              enterKeyHint="done"
            />
            {showSuggestions && (
              <ul className="ql-suggestions" role="listbox">
                {suggestions.map((name, index) => (
                  <li key={name} role="option" aria-selected={index === highlightIndex}>
                    <button
                      type="button"
                      className={index === highlightIndex ? 'is-highlighted' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickSuggestion(name)}
                    >
                      {name}
                      {existingKeys.has(normalizeNameKey(name)) && <span className="ql-tag">已加入</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="ql-add-btn" onClick={addFromDraft} disabled={!parsedDraft}>
            加入
          </button>
        </div>

        {parsedDraft && (
          <div className="ql-preview" aria-live="polite">
            <span className="ql-preview-label">將加入</span>
            <span className="ql-pill ql-pill-name">{parsedDraft.name}</span>
            <span className={`ql-pill ${parsedDraft.qty ? '' : 'ql-pill-missing'}`}>
              {parsedDraft.qty || '數量待填'}
            </span>
            {previewUnit && <span className="ql-pill">{previewUnit}</span>}
            {parsedDraft.note && <span className="ql-pill ql-pill-note">{parsedDraft.note}</span>}
            {parsedDraft.qty !== VAGUE_QTY && (
              <div className="ql-unit-chips" role="group" aria-label="選擇單位">
                {unitChips.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`ql-chip ${previewUnit === unit ? 'is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setUnitOverride(unit)}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="ql-composer-footer">
          <button type="button" className="ql-link-btn" onClick={() => setBulkOpen((previous) => !previous)}>
            {bulkOpen ? '收起批次貼上' : '📋 一次貼上多項'}
          </button>
        </div>

        {bulkOpen && (
          <div className="ql-bulk">
            <textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={copy.bulkPlaceholder}
              rows={5}
            />
            {bulkDrafts.length > 0 && (
              <ul className="ql-bulk-preview">
                {bulkDrafts.map((draft, index) => (
                  <li key={`${draft.name}-${index}`}>
                    <strong>{draft.name}</strong> {draft.qty || <em>數量待填</em>} {draft.unit}
                    {draft.note && <span className="ql-bulk-note">（{draft.note}）</span>}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={addBulk} disabled={bulkDrafts.length === 0}>
              加入 {bulkDrafts.length} 項
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="ql-empty">{copy.empty}</p>
      ) : (
        <ul className="ql-list">
          {items.map((item) => {
            const qtyValue = parseQuantity(item.qty)
            const isVague = item.qty.trim() === VAGUE_QTY
            const isMissingQty = Boolean(item.name.trim()) && !item.qty.trim()
            const isEditingName = editingNameId === item.id || !item.name.trim()
            const isNoteOpen = Boolean(openNoteIds[item.id])

            return (
              <li key={item.id} className={`ql-row ${isMissingQty ? 'is-missing' : ''}`}>
                <div className="ql-name">
                  {isEditingName ? (
                    <input
                      className="ql-name-input"
                      value={item.name}
                      list={kind === 'ingredient' ? 'ingredient-library-options' : 'tool-library-options'}
                      onChange={(event) => onChange(item.id, { name: event.target.value })}
                      onBlur={() => setEditingNameId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setEditingNameId(null)
                        }
                      }}
                      placeholder={`${copy.noun}名稱`}
                      aria-label={`${copy.noun}名稱`}
                      autoFocus={editingNameId === item.id}
                    />
                  ) : (
                    <button
                      type="button"
                      className="ql-name-btn"
                      onClick={() => setEditingNameId(item.id)}
                      title="點一下可修改名稱"
                    >
                      {item.name}
                    </button>
                  )}
                  {item.note && !isNoteOpen && (
                    <button
                      type="button"
                      className="ql-note-text"
                      onClick={() => setOpenNoteIds((previous) => ({ ...previous, [item.id]: true }))}
                    >
                      {item.note}
                    </button>
                  )}
                </div>

                <div className="ql-qty">
                  <button
                    type="button"
                    className="ql-step"
                    onClick={() => stepQty(item, -1)}
                    disabled={isVague || qtyValue === null || qtyValue <= 1}
                    aria-label={`減少 ${item.name}`}
                  >
                    −
                  </button>
                  <input
                    ref={(element) => {
                      if (element) {
                        qtyInputRefs.current.set(item.id, element)
                      } else {
                        qtyInputRefs.current.delete(item.id)
                      }
                    }}
                    className={`ql-qty-input ${isMissingQty ? 'is-missing' : ''}`}
                    value={item.qty}
                    onChange={(event) => onChange(item.id, { qty: event.target.value })}
                    onBlur={(event) => {
                      const parsed = parseQuantity(event.target.value)
                      if (parsed !== null && formatQtyNumber(parsed) !== event.target.value) {
                        onChange(item.id, { qty: formatQtyNumber(parsed) })
                      }
                    }}
                    placeholder="數量"
                    inputMode="decimal"
                    aria-label={`${item.name || copy.noun} 數量`}
                  />
                  <button
                    type="button"
                    className="ql-step"
                    onClick={() => stepQty(item, 1)}
                    disabled={isVague}
                    aria-label={`增加 ${item.name}`}
                  >
                    ＋
                  </button>
                  <input
                    className="ql-unit-input"
                    value={item.unit}
                    list={unitListId}
                    onChange={(event) => onChange(item.id, { unit: event.target.value })}
                    placeholder={isVague ? '' : '單位'}
                    disabled={isVague}
                    aria-label={`${item.name || copy.noun} 單位`}
                  />
                </div>

                <div className="ql-actions">
                  <button
                    type="button"
                    className={`ql-icon-btn ${item.note ? 'has-value' : ''}`}
                    onClick={() => setOpenNoteIds((previous) => ({ ...previous, [item.id]: !previous[item.id] }))}
                    aria-expanded={isNoteOpen}
                  >
                    備註
                  </button>
                  <button
                    type="button"
                    className="ql-icon-btn ql-remove"
                    onClick={() => onRemove(item.id)}
                    aria-label={`刪除 ${item.name || copy.noun}`}
                    title="刪除"
                  >
                    ✕
                  </button>
                </div>

                {isMissingQty && <p className="ql-row-hint">還差數量：填個大概就好，行政組才知道要買多少</p>}

                {isNoteOpen && (
                  <input
                    className="ql-note-input"
                    value={item.note}
                    onChange={(event) => onChange(item.id, { note: event.target.value })}
                    placeholder="備註，例如：切絲、要無鹽的、可與他組共用"
                    aria-label={`${item.name || copy.noun} 備註`}
                    autoFocus
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default ItemQuickList
