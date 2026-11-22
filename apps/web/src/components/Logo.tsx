export function Logo({ size = 22, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#ea580c" />
        <path d="M7 11.5 16 17l9-5.5V22a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 22z" fill="#fff" />
        <path d="M7.5 9.5h17L16 15z" fill="#fff" opacity=".85" />
      </svg>
      {withText && <span className="text-[15px]">Cartero</span>}
    </span>
  )
}
