import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db, firebaseProjectDocId, isFirebaseConfigured } from './firebase'

const GROUP_TABS = ['第一組', '第二組', '第三組', '第四組', '第五組', '第六組', '學長姐組'] as const
const SUMMARY_TABS = ['食材總表', '工具總表'] as const
const SUMMARY_EDIT_PASSCODE = 'foodsheets-admin'
const STORAGE_KEY = 'foodsheets.v1.state'

type GroupTab = (typeof GROUP_TABS)[number]
type TabName = GroupTab | (typeof SUMMARY_TABS)[number]

type IngredientRow = {
  id: number
  ingredient: string
  perServingQty: string
  perServingUnit: string
  totalQty: string
  totalUnit: string
  note: string
}

type ToolRow = {
  id: number
  tool: string
  qty: string
  unit: string
  note: string
}

type IngredientSummaryRow = {
  ingredient: string
  perServingUnit: string
  totalUnit: string
  note: string
  sumPerServingQty: number
  sumTotalQty: number
}

type ToolSummaryRow = {
  tool: string
  unit: string
  note: string
  sumQty: number
}

type GroupData = {
  ingredientRows: IngredientRow[]
  toolRows: ToolRow[]
}

type PersistedState = {
  currentTab: TabName
  groupData: Record<GroupTab, GroupData>
  ingredientAdjustments: Record<string, string>
  toolAdjustments: Record<string, string>
}

const isValidTab = (value: unknown): value is TabName => {
  if (typeof value !== 'string') {
    return false
  }

  return [...GROUP_TABS, ...SUMMARY_TABS].includes(value as TabName)
}

const emptyIngredientRow = (id: number): IngredientRow => ({
  id,
  ingredient: '',
  perServingQty: '',
  perServingUnit: '',
  totalQty: '',
  totalUnit: '',
  note: '',
})

const emptyToolRow = (id: number): ToolRow => ({
  id,
  tool: '',
  qty: '',
  unit: '',
  note: '',
})

const toNumber = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatNumber = (value: number): string => {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const createInitialGroupData = (): Record<GroupTab, GroupData> => {
  return GROUP_TABS.reduce(
    (acc, groupName, index) => {
      const offset = (index + 1) * 1000
      acc[groupName] = {
        ingredientRows: [
          emptyIngredientRow(offset + 1),
          emptyIngredientRow(offset + 2),
          emptyIngredientRow(offset + 3),
        ],
        toolRows: [emptyToolRow(offset + 101), emptyToolRow(offset + 102)],
      }
      return acc
    },
    {} as Record<GroupTab, GroupData>,
  )
}

const loadPersistedState = (): PersistedState | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState>
    if (!parsed.groupData || !parsed.currentTab) {
      return null
    }

    const validTab = isValidTab(parsed.currentTab)
      ? parsed.currentTab
      : '第一組'

    return {
      currentTab: validTab,
      groupData: parsed.groupData,
      ingredientAdjustments: parsed.ingredientAdjustments ?? {},
      toolAdjustments: parsed.toolAdjustments ?? {},
    }
  } catch {
    return null
  }
}

function App() {
  const persistedState = useMemo(loadPersistedState, [])
  const [currentTab, setCurrentTab] = useState<TabName>(persistedState?.currentTab ?? '第一組')
  const [groupData, setGroupData] = useState<Record<GroupTab, GroupData>>(
    persistedState?.groupData ?? createInitialGroupData,
  )
  const [summaryUnlocked, setSummaryUnlocked] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [passcodeError, setPasscodeError] = useState('')
  const [ingredientAdjustments, setIngredientAdjustments] = useState<Record<string, string>>(
    persistedState?.ingredientAdjustments ?? {},
  )
  const [toolAdjustments, setToolAdjustments] = useState<Record<string, string>>(
    persistedState?.toolAdjustments ?? {},
  )
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured ? 'Firebase 已設定，雲端同步初始化中…' : '尚未設定 Firebase，目前僅本機保存',
  )

  const applyingRemoteRef = useRef(false)
  const remoteLoadedRef = useRef(false)

  const activeGroup: GroupTab = GROUP_TABS.includes(currentTab as GroupTab)
    ? (currentTab as GroupTab)
    : '第一組'

  const activeIngredientRows = groupData[activeGroup].ingredientRows
  const activeToolRows = groupData[activeGroup].toolRows

  const allIngredientRows = useMemo(
    () => GROUP_TABS.flatMap((groupName) => groupData[groupName].ingredientRows),
    [groupData],
  )

  const allToolRows = useMemo(
    () => GROUP_TABS.flatMap((groupName) => groupData[groupName].toolRows),
    [groupData],
  )

  const ingredientSummaryRows = useMemo<IngredientSummaryRow[]>(() => {
    const map = new Map<string, IngredientSummaryRow>()

    allIngredientRows.forEach((row) => {
      const ingredientName = row.ingredient.trim()
      if (!ingredientName || !row.totalQty.trim()) {
        return
      }

      const key = [
        ingredientName.toLowerCase(),
        row.perServingUnit.trim().toLowerCase(),
        row.totalUnit.trim().toLowerCase(),
        row.note.trim().toLowerCase(),
      ].join('|')

      if (!map.has(key)) {
        map.set(key, {
          ingredient: ingredientName,
          perServingUnit: row.perServingUnit.trim(),
          totalUnit: row.totalUnit.trim(),
          note: row.note.trim(),
          sumPerServingQty: 0,
          sumTotalQty: 0,
        })
      }

      const target = map.get(key)
      if (!target) {
        return
      }

      target.sumPerServingQty += toNumber(row.perServingQty)
      target.sumTotalQty += toNumber(row.totalQty)
    })

    return Array.from(map.values()).sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'zh-Hant'))
  }, [allIngredientRows])

  const toolSummaryRows = useMemo<ToolSummaryRow[]>(() => {
    const map = new Map<string, ToolSummaryRow>()

    allToolRows.forEach((row) => {
      const toolName = row.tool.trim()
      if (!toolName || !row.qty.trim()) {
        return
      }

      const key = [toolName.toLowerCase(), row.unit.trim().toLowerCase(), row.note.trim().toLowerCase()].join('|')

      if (!map.has(key)) {
        map.set(key, {
          tool: toolName,
          unit: row.unit.trim(),
          note: row.note.trim(),
          sumQty: 0,
        })
      }

      const target = map.get(key)
      if (!target) {
        return
      }

      target.sumQty += toNumber(row.qty)
    })

    return Array.from(map.values()).sort((a, b) => a.tool.localeCompare(b.tool, 'zh-Hant'))
  }, [allToolRows])

  const invalidIngredientRowIds = useMemo(
    () =>
      new Set(
        activeIngredientRows
          .filter((row) => row.ingredient.trim() && !row.totalQty.trim())
          .map((row) => row.id),
      ),
    [activeIngredientRows],
  )

  const invalidToolRowIds = useMemo(
    () => new Set(activeToolRows.filter((row) => row.tool.trim() && !row.qty.trim()).map((row) => row.id)),
    [activeToolRows],
  )

  const updateIngredientRow = (
    groupName: GroupTab,
    id: number,
    field: keyof IngredientRow,
    value: string,
  ) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: previous[groupName].ingredientRows.map((row) =>
          row.id === id ? { ...row, [field]: value } : row,
        ),
      },
    }))
  }

  const updateToolRow = (groupName: GroupTab, id: number, field: keyof ToolRow, value: string) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: previous[groupName].toolRows.map((row) =>
          row.id === id ? { ...row, [field]: value } : row,
        ),
      },
    }))
  }

  const addIngredientRow = (groupName: GroupTab) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        ingredientRows: [...previous[groupName].ingredientRows, emptyIngredientRow(Date.now())],
      },
    }))
  }

  const addToolRow = (groupName: GroupTab) => {
    setGroupData((previous) => ({
      ...previous,
      [groupName]: {
        ...previous[groupName],
        toolRows: [...previous[groupName].toolRows, emptyToolRow(Date.now() + 77)],
      },
    }))
  }

  const removeIngredientRow = (groupName: GroupTab, id: number) => {
    setGroupData((previous) => {
      const nextRows = previous[groupName].ingredientRows.filter((row) => row.id !== id)
      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          ingredientRows: nextRows.length > 0 ? nextRows : [emptyIngredientRow(Date.now())],
        },
      }
    })
  }

  const removeToolRow = (groupName: GroupTab, id: number) => {
    setGroupData((previous) => {
      const nextRows = previous[groupName].toolRows.filter((row) => row.id !== id)
      return {
        ...previous,
        [groupName]: {
          ...previous[groupName],
          toolRows: nextRows.length > 0 ? nextRows : [emptyToolRow(Date.now())],
        },
      }
    })
  }

  const unlockSummaryEdit = () => {
    if (passcode !== SUMMARY_EDIT_PASSCODE) {
      setPasscodeError('權限碼錯誤，無法編輯總表。')
      return
    }

    setPasscodeError('')
    setSummaryUnlocked(true)
    setPasscode('')
  }

  const lockSummaryEdit = () => {
    setSummaryUnlocked(false)
    setPasscode('')
    setPasscodeError('')
  }

  const renderSummaryGuard = () => (
    <section className="panel">
      <div className="lock-row">
        <p className="hint lock-text">總表預設唯讀，避免誤改。需管理權限才可輸入「調整量」。</p>
        {summaryUnlocked ? (
          <button className="btn-danger" onClick={lockSummaryEdit}>
            鎖定總表編輯
          </button>
        ) : (
          <div className="lock-form">
            <input
              type="password"
              placeholder="輸入權限碼"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
            />
            <button onClick={unlockSummaryEdit}>授權編輯</button>
          </div>
        )}
      </div>
      {passcodeError && <p className="error">{passcodeError}</p>}
    </section>
  )

  useEffect(() => {
    const payload: PersistedState = {
      currentTab,
      groupData,
      ingredientAdjustments,
      toolAdjustments,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [currentTab, groupData, ingredientAdjustments, toolAdjustments])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      return
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const unsubscribe = onSnapshot(
      projectRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：首次資料將由目前內容建立')
          return
        }

        const data = snapshot.data() as Partial<PersistedState>
        if (!data.groupData || !data.currentTab) {
          remoteLoadedRef.current = true
          setSyncStatus('已連線雲端：資料格式不完整，保留本機內容')
          return
        }

        applyingRemoteRef.current = true
        setCurrentTab(isValidTab(data.currentTab) ? data.currentTab : '第一組')
        setGroupData(data.groupData)
        setIngredientAdjustments(data.ingredientAdjustments ?? {})
        setToolAdjustments(data.toolAdjustments ?? {})
        remoteLoadedRef.current = true
        setSyncStatus('已連線雲端：即時同步中')
        setTimeout(() => {
          applyingRemoteRef.current = false
        }, 0)
      },
      () => {
        setSyncStatus('雲端同步失敗，已切換為本機模式')
      },
    )

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !db || !remoteLoadedRef.current || applyingRemoteRef.current) {
      return
    }

    const payload: PersistedState = {
      currentTab,
      groupData,
      ingredientAdjustments,
      toolAdjustments,
    }

    const projectRef = doc(db, 'projects', firebaseProjectDocId)
    const timer = window.setTimeout(() => {
      setDoc(projectRef, payload, { merge: true }).catch(() => {
        setSyncStatus('雲端寫入失敗，資料仍保留在本機')
      })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [currentTab, groupData, ingredientAdjustments, toolAdjustments])

  return (
    <main className="page">
      <h1>料理採購管理</h1>
      <p className="hint">{syncStatus}</p>

      <section className="tabs panel">
        {[...GROUP_TABS, ...SUMMARY_TABS].map((tabName) => (
          <button
            key={tabName}
            className={currentTab === tabName ? 'tab-active' : ''}
            onClick={() => setCurrentTab(tabName)}
          >
            {tabName}
          </button>
        ))}
      </section>

      {GROUP_TABS.includes(currentTab as GroupTab) && (
        <>
          <p className="hint">{activeGroup}：有填食材時，總量必填；有填工具時，數量必填。</p>

          <section className="panel">
            <h2>食材輸入</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>食材</th>
                    <th>一份數量</th>
                    <th>單位</th>
                    <th>總量*</th>
                    <th>總量單位</th>
                    <th>備註</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeIngredientRows.map((row) => (
                    <tr key={row.id} className={invalidIngredientRowIds.has(row.id) ? 'row-invalid' : ''}>
                      <td>
                        <input
                          value={row.ingredient}
                          onChange={(event) =>
                            updateIngredientRow(activeGroup, row.id, 'ingredient', event.target.value)
                          }
                          placeholder="例如：辣椒粉"
                        />
                      </td>
                      <td>
                        <input
                          value={row.perServingQty}
                          onChange={(event) =>
                            updateIngredientRow(activeGroup, row.id, 'perServingQty', event.target.value)
                          }
                          placeholder="例如：10"
                        />
                      </td>
                      <td>
                        <input
                          value={row.perServingUnit}
                          onChange={(event) =>
                            updateIngredientRow(activeGroup, row.id, 'perServingUnit', event.target.value)
                          }
                          placeholder="例如：g"
                        />
                      </td>
                      <td>
                        <input
                          value={row.totalQty}
                          onChange={(event) =>
                            updateIngredientRow(activeGroup, row.id, 'totalQty', event.target.value)
                          }
                          placeholder="必填（有食材時）"
                        />
                      </td>
                      <td>
                        <input
                          value={row.totalUnit}
                          onChange={(event) =>
                            updateIngredientRow(activeGroup, row.id, 'totalUnit', event.target.value)
                          }
                          placeholder="例如：包"
                        />
                      </td>
                      <td>
                        <input
                          value={row.note}
                          onChange={(event) => updateIngredientRow(activeGroup, row.id, 'note', event.target.value)}
                          placeholder="例如：共用材料"
                        />
                      </td>
                      <td>
                        <button className="btn-danger" onClick={() => removeIngredientRow(activeGroup, row.id)}>
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button onClick={() => addIngredientRow(activeGroup)}>新增食材列</button>
            </div>
            {invalidIngredientRowIds.size > 0 && (
              <p className="error">目前有 {invalidIngredientRowIds.size} 列未填總量，未被納入食材總表。</p>
            )}
          </section>

          <section className="panel">
            <h2>工具輸入</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>數量*</th>
                    <th>單位</th>
                    <th>備註</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeToolRows.map((row) => (
                    <tr key={row.id} className={invalidToolRowIds.has(row.id) ? 'row-invalid' : ''}>
                      <td>
                        <input
                          value={row.tool}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'tool', event.target.value)}
                          placeholder="例如：炒鍋"
                        />
                      </td>
                      <td>
                        <input
                          value={row.qty}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'qty', event.target.value)}
                          placeholder="有填工具時必填"
                        />
                      </td>
                      <td>
                        <input
                          value={row.unit}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'unit', event.target.value)}
                          placeholder="例如：個"
                        />
                      </td>
                      <td>
                        <input
                          value={row.note}
                          onChange={(event) => updateToolRow(activeGroup, row.id, 'note', event.target.value)}
                          placeholder="例如：共用"
                        />
                      </td>
                      <td>
                        <button className="btn-danger" onClick={() => removeToolRow(activeGroup, row.id)}>
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button onClick={() => addToolRow(activeGroup)}>新增工具列</button>
            </div>
            {invalidToolRowIds.size > 0 && (
              <p className="error">目前有 {invalidToolRowIds.size} 列未填工具數量，未被納入工具總表。</p>
            )}
          </section>
        </>
      )}

      {currentTab === '食材總表' && (
        <>
          {renderSummaryGuard()}
          <section className="panel">
            <h2>食材總表</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>食材</th>
                    <th>一份數量總和</th>
                    <th>單位</th>
                    <th>總量總和</th>
                    <th>調整量</th>
                    <th>最終總量</th>
                    <th>總量單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredientSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {ingredientSummaryRows.map((row) => {
                    const key = `${row.ingredient}-${row.perServingUnit}-${row.totalUnit}-${row.note}`
                    const adjustment = toNumber(ingredientAdjustments[key] ?? '')
                    const finalTotal = row.sumTotalQty + adjustment

                    return (
                      <tr key={key}>
                        <td>{row.ingredient}</td>
                        <td>{formatNumber(row.sumPerServingQty)}</td>
                        <td>{row.perServingUnit}</td>
                        <td>{formatNumber(row.sumTotalQty)}</td>
                        <td>
                          <input
                            value={ingredientAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setIngredientAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            disabled={!summaryUnlocked}
                            placeholder="0"
                          />
                        </td>
                        <td>{formatNumber(finalTotal)}</td>
                        <td>{row.totalUnit}</td>
                        <td>{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {currentTab === '工具總表' && (
        <>
          {renderSummaryGuard()}
          <section className="panel">
            <h2>工具總表</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>需求數量</th>
                    <th>調整量</th>
                    <th>最終數量</th>
                    <th>單位</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {toolSummaryRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">
                        尚無可彙總資料
                      </td>
                    </tr>
                  )}
                  {toolSummaryRows.map((row) => {
                    const key = `${row.tool}-${row.unit}-${row.note}`
                    const adjustment = toNumber(toolAdjustments[key] ?? '')
                    const finalTotal = row.sumQty + adjustment

                    return (
                      <tr key={key}>
                        <td>{row.tool}</td>
                        <td>{formatNumber(row.sumQty)}</td>
                        <td>
                          <input
                            value={toolAdjustments[key] ?? ''}
                            onChange={(event) =>
                              setToolAdjustments((previous) => ({
                                ...previous,
                                [key]: event.target.value,
                              }))
                            }
                            disabled={!summaryUnlocked}
                            placeholder="0"
                          />
                        </td>
                        <td>{formatNumber(finalTotal)}</td>
                        <td>{row.unit}</td>
                        <td>{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export default App
