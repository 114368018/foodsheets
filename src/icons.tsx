export type IconName =
  | 'chevron'
  | 'close'
  | 'plus'
  | 'trash'
  | 'image'
  | 'clipboard'
  | 'link'
  | 'download'
  | 'pencil'
  | 'lock'
  | 'check'
  | 'camera'
  | 'list'
  | 'cart'
  | 'book'
  | 'box'
  | 'grid'
  | 'tool'
  | 'tag'
  | 'copy'
  | 'wallet'

const PATHS: Record<IconName, string> = {
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 1 0 0-.01',
  clipboard: 'M9 4h6v3H9zM9 5H6v15h12V5h-3',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  cart: 'M3 4h2.5l2.2 11h10.6L20.5 8H6.6M9.5 19.5h.01M17 19.5h.01',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tool: 'M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z',
  tag: 'M4 4h7l9 9-7 7-9-9zM8.5 8.5h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  wallet: 'M4 7h15v12H4zM4 7l11-3v3M15 13h.01',
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className={`icon icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
