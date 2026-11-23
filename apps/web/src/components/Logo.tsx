import { t } from "@/i18n";

/** Troqueles del borde del sello (coordenadas en un lienzo de 32×32). */
const NOTCHES = [[2, 2], [2, 30], [9, 2], [9, 30], [16, 2], [16, 30], [23, 2], [23, 30], [30, 2], [30, 30], [2, 9], [30, 9], [2, 16], [30, 16], [2, 23], [30, 23]]

export function Logo({ size = 22, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        {/* Sello postal con llaves: el cartero que lleva tu petición */}
        <mask id="cartero-perforado">
          <rect width="32" height="32" fill="#fff" />
          {NOTCHES.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" fill="#000" />
          ))}
        </mask>
        <rect x="2" y="2" width="28" height="28" fill="#ea580c" mask="url(#cartero-perforado)" />
        <g fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 8.8C11 8.8 10.4 9.8 10.4 11.8V13.7C10.4 15.2 9.8 16 8.2 16C9.8 16 10.4 16.8 10.4 18.3V20.2C10.4 22.2 11 23.2 13 23.2" />
          <path d="M19 8.8C21 8.8 21.6 9.8 21.6 11.8V13.7C21.6 15.2 22.2 16 23.8 16C22.2 16 21.6 16.8 21.6 18.3V20.2C21.6 22.2 21 23.2 19 23.2" />
        </g>
      </svg>
      {withText && <span className="text-[15px]">{t("Cartero")}</span>}
    </span>
  )
}
