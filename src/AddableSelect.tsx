import { useState } from 'react'

export type SelectOption = { value: string; label: string; disabled?: boolean }

type AddableSelectProps = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  // Called with the typed name; picking an option that already exists goes through onChange instead.
  onAdd: (name: string) => void
  addLabel: string
  addPlaceholder: string
  ariaLabel: string
  className: string
  inputClassName?: string
}

const ADD_VALUE = '__add_option__'

// A dropdown whose last choice is "add a new one": picking it turns the dropdown into a text box.
// Enter or leaving the box confirms; Esc or leaving it empty goes back to the dropdown.
export const AddableSelect = ({
  value,
  options,
  onChange,
  onAdd,
  addLabel,
  addPlaceholder,
  ariaLabel,
  className,
  inputClassName,
}: AddableSelectProps) => {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <select
        className={className}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => {
          if (event.target.value === ADD_VALUE) {
            setDraft('')
          } else {
            onChange(event.target.value)
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        <option value={ADD_VALUE}>{addLabel}</option>
      </select>
    )
  }

  const confirm = () => {
    const name = draft.trim()
    setDraft(null)
    if (!name) {
      return
    }
    const existing = options.find((option) => option.value === name || option.label === name)
    if (existing) {
      onChange(existing.value)
    } else {
      onAdd(name)
    }
  }

  return (
    <input
      className={inputClassName ?? className}
      value={draft}
      placeholder={addPlaceholder}
      aria-label={addPlaceholder}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={confirm}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          // Inside a form, Enter only confirms the new name.
          event.preventDefault()
          confirm()
        } else if (event.key === 'Escape') {
          setDraft(null)
        }
      }}
    />
  )
}
