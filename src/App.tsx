import { useMemo, useState } from 'react'

type IngredientRow = {
  id: number
  ingredient: string
  perServingQty: string
  perServingUnit: string
  totalQty: string
  totalUnit: string
  note: string
}

type SummaryRow = {
  ingredient: string
  perServingUnit: string
  totalUnit: string
  note: string
  sumPerServingQty: number
  sumTotalQty: number
}

const emptyRow = (id: number): IngredientRow => ({
  id,
  ingredient: '',
  perServingQty: '',
  perServingUnit: '',
  totalQty: '',
  totalUnit: '',
  note: '',
})

const toNumber = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const formatNumber = (value: number): string => {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function App() {
  const [rows, setRows] = useState<IngredientRow[]>([emptyRow(1), emptyRow(2), emptyRow(3)])

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const map = new Map<string, SummaryRow>()

    rows.forEach((row) => {
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

    return Array.from(map.values()).sort((a, b) =>
      a.ingredient.localeCompare(b.ingredient, 'zh-Hant'),
    )
  }, [rows])

  const invalidRowIds = useMemo(() => {
    return new Set(
      rows
        .filter((row) => row.ingredient.trim() && !row.totalQty.trim())
        .map((row) => row.id),
    )
  }, [rows])

  const updateRow = (id: number, field: keyof IngredientRow, value: string) => {
    setRows((previous) =>
      previous.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    )
  }

  const addRow = () => {
    setRows((previous) => [...previous, emptyRow(Date.now())])
  }

  const removeRow = (id: number) => {
    setRows((previous) => {
      if (previous.length === 1) {
        return [emptyRow(Date.now())]
      }

      return previous.filter((row) => row.id !== id)
    })
  }

  return (
    <main className="page">
      <h1>食材編輯表</h1>
      <p className="hint">規則：有填食材時，總量必填。總表只彙總符合規則的列。</p>

      <section className="panel">
        <h2>輸入區</h2>
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
              {rows.map((row) => {
                const invalid = invalidRowIds.has(row.id)

                return (
                  <tr key={row.id} className={invalid ? 'row-invalid' : ''}>
                    <td>
                      <input
                        value={row.ingredient}
                        onChange={(event) => updateRow(row.id, 'ingredient', event.target.value)}
                        placeholder="例如：辣椒粉"
                      />
                    </td>
                    <td>
                      <input
                        value={row.perServingQty}
                        onChange={(event) => updateRow(row.id, 'perServingQty', event.target.value)}
                        placeholder="例如：10"
                      />
                    </td>
                    <td>
                      <input
                        value={row.perServingUnit}
                        onChange={(event) => updateRow(row.id, 'perServingUnit', event.target.value)}
                        placeholder="例如：g"
                      />
                    </td>
                    <td>
                      <input
                        value={row.totalQty}
                        onChange={(event) => updateRow(row.id, 'totalQty', event.target.value)}
                        placeholder="必填（有食材時）"
                      />
                    </td>
                    <td>
                      <input
                        value={row.totalUnit}
                        onChange={(event) => updateRow(row.id, 'totalUnit', event.target.value)}
                        placeholder="例如：包"
                      />
                    </td>
                    <td>
                      <input
                        value={row.note}
                        onChange={(event) => updateRow(row.id, 'note', event.target.value)}
                        placeholder="例如：共用材料"
                      />
                    </td>
                    <td>
                      <button className="btn-danger" onClick={() => removeRow(row.id)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button onClick={addRow}>新增一列</button>
        </div>
        {invalidRowIds.size > 0 && (
          <p className="error">目前有 {invalidRowIds.size} 列未填總量，未被納入總表。</p>
        )}
      </section>

      <section className="panel">
        <h2>食材總表（自動彙總）</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>食材</th>
                <th>一份數量總和</th>
                <th>單位</th>
                <th>總量總和</th>
                <th>總量單位</th>
                <th>備註</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    尚無可彙總資料
                  </td>
                </tr>
              )}
              {summaryRows.map((row) => (
                <tr key={`${row.ingredient}-${row.perServingUnit}-${row.totalUnit}-${row.note}`}>
                  <td>{row.ingredient}</td>
                  <td>{formatNumber(row.sumPerServingQty)}</td>
                  <td>{row.perServingUnit}</td>
                  <td>{formatNumber(row.sumTotalQty)}</td>
                  <td>{row.totalUnit}</td>
                  <td>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
