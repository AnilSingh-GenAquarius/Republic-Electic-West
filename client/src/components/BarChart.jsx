import { useMemo, useState } from 'react'

/**
 * Single-series column chart (SVG). data = [{ key, label, value, tip: [ [k,v], ... ] }].
 * Spec: ≤24px columns, 4px rounded tops anchored to a single baseline, hairline grid,
 * per-column hover tooltip, value label on the last column only, and an optional table view.
 */
export default function BarChart({ data, format = (v) => v, height = 200, ariaLabel, showTable, onBarClick }) {
  const [hover, setHover] = useState(null)
  const W = 640, H = height, padL = 48, padR = 12, padT = 18, padB = 26
  const innerW = W - padL - padR, innerH = H - padT - padB

  const { ticks, max } = useMemo(() => {
    const m = Math.max(0, ...data.map((d) => d.value || 0))
    if (!m) return { ticks: [0], max: 1 }
    const raw = m / 4, mag = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw)
    const top = Math.ceil(m / step) * step
    return { ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step), max: top }
  }, [data])

  const compact = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${v}`)
  const slot = innerW / Math.max(1, data.length)
  const bw = Math.min(24, slot * 0.6)
  const y = (v) => padT + innerH - (v / max) * innerH

  if (showTable) {
    return (
      <table className="grid compact">
        <thead><tr><th>Period</th><th className="num">Value</th>{data[0]?.tip?.map(([k]) => <th key={k} className="num">{k}</th>)}</tr></thead>
        <tbody>{data.map((d) => (
          <tr key={d.key} className={onBarClick ? 'link-row' : ''} onClick={onBarClick ? () => onBarClick(d) : undefined}><td>{onBarClick ? <a href="#" onClick={(e) => e.preventDefault()}>{d.label}</a> : d.label}</td><td className="num">{format(d.value)}</td>{d.tip?.map(([k, v]) => <td key={k} className="num">{v}</td>)}</tr>
        ))}</tbody>
      </table>
    )
  }

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          const v = d.value || 0
          const top = y(v), hgt = padT + innerH - top
          const r = Math.min(4, hgt, bw / 2)
          const x0 = cx - bw / 2, x1 = cx + bw / 2, base = padT + innerH
          const path = hgt <= 0 ? '' :
            `M${x0},${base} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x1 - r},${top} Q${x1},${top} ${x1},${top + r} L${x1},${base} Z`
          const showLabel = i === data.length - 1 || hover === i
          return (
            <g key={d.key}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                style={onBarClick ? { cursor: 'pointer' } : undefined}
                onClick={onBarClick ? () => onBarClick(d) : undefined}
                onKeyDown={onBarClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onBarClick(d) : undefined}
                role={onBarClick ? 'link' : undefined}
                aria-label={`${d.label}: ${format(v)}${onBarClick ? ' – open details' : ''}`} />
              {path && <path d={path} className={`chart-bar${hover === i ? ' hover' : ''}${hover != null && hover !== i ? ' dim' : ''}`} pointerEvents="none" />}
              {showLabel && v > 0 && <text x={cx} y={top - 6} textAnchor="middle" className="chart-value">{compact(Math.round(v))}</text>}
              {(data.length <= 12 || i % 2 === 0) && <text x={cx} y={H - 8} textAnchor="middle" className="chart-axis">{d.short || d.label}</text>}
            </g>
          )
        })}
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} className="chart-baseline" />
      </svg>
      {hover != null && data[hover] && (
        <div className="chart-tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
          <div className="chart-tip-title">{data[hover].label}</div>
          <div className="chart-tip-row"><span>Total</span><b>{format(data[hover].value)}</b></div>
          {data[hover].tip?.map(([k, v]) => <div key={k} className="chart-tip-row"><span>{k}</span><b>{v}</b></div>)}
          {onBarClick && <div className="chart-tip-hint">Click to open details</div>}
        </div>
      )}
    </div>
  )
}
