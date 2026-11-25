import { useId, useState, type SVGProps } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { Clipboard, File, Image, Link2, NotebookPen, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";

// Paper-map drawing adapted from the supplied GoRide component.
type GorideCityPlanProps = SVGProps< SVGSVGElement > & {
  // 'ink' is the paper map on the page; 'app' is the same streets in the app's colours, seen through the phone
  variant: 'ink' | 'app'
  width: number
  height: number
  spacing: number
  angle: number
  center: { x: number; y: number }
  reach: number
  avenueEvery: number
  river: string

  // Two-block parks, by the crossing at their top-left corner
  parks: { i: number; j: number }[]

  // District names, written small into the app's map only
  labels?: { name: string; x: number; y: number }[]

  // Road names, written along the avenues of the paper map
  roads?: string[]
}

const range = (reach: number) => Array.from({ length: reach * 2 + 1 }, (_, k) => k - reach)

// A steady pseudo-random 0–1 per block, so the paper tones never reshuffle between renders
const tone = (i: number, j: number) => {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453

  return n - Math.floor(n)
}

/**
 * The street grid as one drawing in panel px: toned blocks, parks and the river under it, avenues
 * wider than streets. Drawn twice from the same numbers, so the phone's view lines up with the page
 */
const GorideCityPlan = ({
  variant,
  width,
  height,
  spacing,
  angle,
  center,
  reach,
  avenueEvery,
  river,
  parks,
  labels = [],
  roads = [],
  ...props
}: GorideCityPlanProps) => {
  // Hooks
  const id = useId()

  // Vars
  const app = variant === 'app'
  const far = reach * spacing
  const lines = range(reach)
  const rad = (angle * Math.PI) / 180
  const gap = spacing * (app ? 0.1 : 0.09)

  // Paper blocks only where they can be seen, in a few tones from the same warm paper colour
  const blocks = app
    ? []
    : lines.flatMap(i =>
        lines
          .map(j => ({ i, j, shade: tone(i, j) }))
          .filter(({ i: bi, j: bj, shade }) => {
            const cx = center.x + (bi + 0.5) * spacing * Math.cos(rad) - (bj + 0.5) * spacing * Math.sin(rad)
            const cy = center.y + (bi + 0.5) * spacing * Math.sin(rad) + (bj + 0.5) * spacing * Math.cos(rad)

            return shade > 0.28 && cx > -spacing && cx < width + spacing && cy > -spacing && cy < height + spacing
          })
      )

  const avenues = lines.filter(k => k % avenueEvery === 0 && Math.abs(k) < reach - 1)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill='none' aria-hidden {...props}>
      <defs>
        <pattern id={id} width='7' height='7' patternUnits='userSpaceOnUse'>
          <circle cx='3.5' cy='3.5' r='0.9' className='fill-(--gr-ink)' fillOpacity='0.16' />
        </pattern>
      </defs>

      {app && <rect width={width} height={height} className='fill-(--gr-mapBlock)' />}

      <g transform={`translate(${center.x} ${center.y}) rotate(${angle})`}>
        {blocks.map(block => (
          <rect
            key={`${block.i}:${block.j}`}
            x={block.i * spacing + gap}
            y={block.j * spacing + gap}
            width={spacing - gap * 2}
            height={spacing - gap * 2}
            rx='2'
            className='fill-(--gr-paperBlock)'
            fillOpacity={0.35 + block.shade * 0.65}
          />
        ))}

        {parks.map(park => (
          <g key={`${park.i}:${park.j}`}>
            <rect
              x={park.i * spacing + gap}
              y={park.j * spacing + gap}
              width={spacing * 2 - gap * 2}
              height={spacing - gap * 2}
              rx={app ? spacing * 0.12 : 3}
              className={app ? 'fill-(--gr-mapPark)' : 'fill-(--gr-paperPark)'}
            />
            {!app && (
              <rect
                x={park.i * spacing + gap}
                y={park.j * spacing + gap}
                width={spacing * 2 - gap * 2}
                height={spacing - gap * 2}
                rx='3'
                fill={`url(#${id})`}
              />
            )}
          </g>
        ))}
      </g>

      <path
        d={river}
        strokeWidth={spacing * 0.8}
        strokeLinecap='round'
        className={app ? 'stroke-(--gr-mapWater)' : 'stroke-(--gr-paperWater)'}
      />

      <g transform={`translate(${center.x} ${center.y}) rotate(${angle})`}>
        {lines.map(k => {
          const avenue = k % avenueEvery === 0
          const stroke = app ? (avenue ? spacing * 0.32 : spacing * 0.2) : avenue ? spacing * 0.2 : 1
          const paint = app || avenue ? 'stroke-(--gr-mapRoad)' : 'stroke-(--gr-ink)'
          const opacity = app || avenue ? 1 : 0.07

          return (
            <g key={k}>
              <line
                x1={k * spacing}
                x2={k * spacing}
                y1={-far}
                y2={far}
                strokeWidth={stroke}
                className={paint}
                strokeOpacity={opacity}
              />
              <line
                x1={-far}
                x2={far}
                y1={k * spacing}
                y2={k * spacing}
                strokeWidth={stroke}
                className={paint}
                strokeOpacity={opacity}
              />
            </g>
          )
        })}

        {/* Each avenue carries its name once, along the road, like a printed map */}
        {!app &&
          roads.length > 0 &&
          avenues.map((k, index) => (
            <g key={`road-${k}`} className='fill-(--gr-ink)' fillOpacity='0.32'>
              <text
                x={k * spacing}
                y={(index % 2 ? 1.5 : -2.5) * spacing}
                transform={`rotate(-90 ${k * spacing} ${(index % 2 ? 1.5 : -2.5) * spacing})`}
                textAnchor='middle'
                dominantBaseline='central'
                fontSize={spacing * 0.17}
                fontWeight='600'
                letterSpacing='0.18em'
 >
                {roads[index % roads.length].toUpperCase()}
              </text>
              <text
                x={(index % 2 ? -1.5 : 2.5) * spacing}
                y={k * spacing}
                textAnchor='middle'
                dominantBaseline='central'
                fontSize={spacing * 0.17}
                fontWeight='600'
                letterSpacing='0.18em'
 >
                {roads[(index + 3) % roads.length].toUpperCase()}
              </text>
            </g>
          ))}
      </g>

      {app &&
        labels.map(label => (
          <text
            key={label.name}
            x={label.x}
            y={label.y}
            textAnchor='middle'
            className='fill-(--gr-ink) font-semibold'
            fillOpacity='0.5'
            fontSize={spacing * 0.2}
            letterSpacing='0.04em'
 >
            {label.name.toUpperCase()}
          </text>
        ))}
    </svg>
  )
}

const types = [
  { label: "Notes", description: "A quick update or a block of code.", icon: NotebookPen },
  { label: "Links", description: "A reference the whole room can open.", icon: Link2 },
  { label: "Images", description: "Share a screenshot without switching apps.", icon: Image },
  { label: "Files", description: "Drop a document, media file, or folder.", icon: File },
];

export function GoRide({ className }: { className?: string }) {
  const [selected, setSelected] = useState(0);
  const reduced = useReducedMotion();
  const sample = types[selected];
  return (
    <LazyMotion features={domAnimation}>
      <section className={cn("launch-hero", className)} aria-labelledby="launch-title">
        <div className="launch-copy">
          <p className="launch-mode"><span /> Clipdrop Web</p>
          <h1 id="launch-title">Share it.<br /><em>Skip the setup.</em></h1>
          <p className="launch-lede">Open a room and drop in text, links, images, or files. Send the link or QR code so anyone can join from a browser.</p>
          <div className="launch-actions">
            <a className="launch-primary" href="#create">Create a room</a>
            <a className="launch-secondary" href="#join"><ScanLine aria-hidden /> Join with a code</a>
          </div>
        </div>
        <div className="launch-visual">
          <GorideCityPlan className="launch-plan" variant="ink" width={680} height={485} spacing={42}
            angle={-19} center={{ x: 330, y: 230 }} reach={12} avenueEvery={3}
            river="M510 -40C515 119 368 266 431 330S552 426 578 540"
            parks={[{ i: -6, j: -2 }, { i: 4, j: 2 }, { i: 3, j: -5 }]} />
          <svg className="launch-route" viewBox="0 0 680 485" aria-hidden>
            <m.path d="M36 329h102v-84h111v-95h162v111h125"
              initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
              transition={{ duration: reduced ? 0 : 1.2, ease: "easeOut" }} />
            <circle cx="36" cy="329" r="8" /><circle cx="536" cy="261" r="8" />
          </svg>
          <div className="launch-phone">
            <div className="phone-notch" aria-hidden />
            <div className="phone-top"><span className="phone-icon"><Clipboard aria-hidden /></span><span><strong>Room board</strong><small>Example room</small></span></div>
            <div className="phone-panel" aria-live="polite">
              <sample.icon aria-hidden />
              <strong>{sample.label}</strong>
              <p>{sample.description}</p>
            </div>
            <div className="phone-tabs" role="group" aria-label="Preview room content types">
              {types.map(({ label, icon: Icon }, index) => <button key={label} type="button"
                aria-pressed={selected === index} onClick={() => setSelected(index)}><Icon aria-hidden />{label}</button>)}
            </div>
          </div>
        </div>
      </section>
    </LazyMotion>
  );
}
