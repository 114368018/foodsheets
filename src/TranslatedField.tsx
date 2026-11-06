import { useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

// A field whose stored text may be in another language. It shows `display` (the translation) until
// someone clicks into it, then the real text to edit, so a translation can never be saved by accident.
type DisplayProps = { value: string; display?: string }

const useShownValue = ({ value, display }: DisplayProps) => {
  const [focused, setFocused] = useState(false)
  const translated = !focused && display !== undefined && display !== value
  return { shown: translated ? display : value, translated, setFocused }
}

export const TranslatedInput = ({
  value,
  display,
  onFocus,
  onBlur,
  title,
  ...props
}: DisplayProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'value'>) => {
  const { shown, translated, setFocused } = useShownValue({ value, display })
  return (
    <input
      {...props}
      value={shown}
      title={translated ? value : title}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        onBlur?.(event)
        setFocused(false)
      }}
    />
  )
}

export const TranslatedTextarea = ({
  value,
  display,
  onFocus,
  onBlur,
  ...props
}: DisplayProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'>) => {
  const { shown, setFocused } = useShownValue({ value, display })
  return (
    <textarea
      {...props}
      value={shown}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        onBlur?.(event)
        setFocused(false)
      }}
    />
  )
}
