import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Link2Off, MoveHorizontal, MoveVertical, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { NodeStyle, SpacingBox } from './portalPageModel';

/* Padding and margin.
 *
 * ⚠️ ONE design. It was two behind a tab — "Two fields" and "Four sides" — so the shape could be
 * chosen from the real control rather than a sketch; Zeni picked this one and the other is deleted. They
 * shared every write path, so its going took no behaviour with it.
 *
 * ⚠️ THE NUMBERS ARE THE TARGETS. Every side is a real 32px input — click it and type, or drag
 * sideways on it to scrub — so the smallest thing you have to hit is a field, not a hairline edge.
 *
 * ⚠️ An unset side shows what the element RESTS at. A section carries 24px either side from its own
 * classes, so printing 0 there said there was no space when there plainly was, and gave no way to tell
 * that typing 0 would remove it. It used to be printed in GREY to say "nobody set this" — a true and
 * secondary fact, told in the one way that also reads as "this field is disabled", which is how a panel
 * of eight live inputs came to look switched off. Every value is at full strength now.
 *
 * ⚠️ EVERY SIDE IS px. Left and right were a percentage of the parent, so one control carried two
 * scales and had to caption them; the unit now rides in each field's own divided cell. */

type Ring = 'margin' | 'padding';
type Side = keyof SpacingBox;

interface Props {
  style: NodeStyle;
  onChange: (patch: Partial<NodeStyle>) => void;
  /* ⚠️ Restricts the widget to ONE ring. A divider and a shape have no inside, so they get a margin
     box and no padding box at all — NEW-ELEMENT-PANELS-SPEC §3.6/§3.14. Showing both and letting one
     do nothing is the failure that spec spends its first section arguing against. */
  only?: Ring;
  /* ⚠️ What the element ACTUALLY has on the sides nobody has set. See the grey/dark note above. */
  resting?: { padding?: SpacingBox; margin?: SpacingBox };
  /* The node on the canvas, so hovering a side can light that band. Optional: the legacy element
     panel has no id to give, and the fields are still correct without the highlight. */
  nodeId?: string;
}

/** An element that paints its own card keeps its padding on the card, one level in. */
/* ⚠️ A DATA CARD keeps its inset deeper still — on its header and rows (`px-4`), with the card itself
   and its first child both at 0. So the search goes breadth-first a few levels down for the first box
   that carries horizontal padding AND sits flush with the card's edge (within 2px — the card's own
   1px border). Flush is the test that it is the card's inset, not some inner chip's padding. */
function padBoxOf(el: HTMLElement): HTMLElement {
  const padded = (e: HTMLElement) => {
    const c = getComputedStyle(e);
    return (['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const).some((k) => parseFloat(c[k]) > 0);
  };
  if (padded(el)) return el;
  const r = el.getBoundingClientRect();
  let level: HTMLElement[] = [...el.children] as HTMLElement[];
  for (let depth = 0; depth < 4 && level.length; depth += 1) {
    for (const k of level) {
      const kr = k.getBoundingClientRect();
      if (padded(k) && Math.abs(kr.left - r.left) <= 2 && Math.abs(kr.right - r.right) <= 2) return k;
    }
    level = level.flatMap((k) => [...k.children] as HTMLElement[]);
  }
  return (el.firstElementChild as HTMLElement | null) ?? el;
}

/** Measures an element's resting padding and margin off the canvas — every side in px, the unit the
 *  fields are in. (It used to convert the horizontal pair to a % of the parent, because that was the
 *  unit they were stored in; nothing is a percentage any more.) */
export function useRestingSpacing(nodeId: string, deps: unknown): { padding?: SpacingBox; margin?: SpacingBox } {
  const [box, setBox] = useState<{ padding?: SpacingBox; margin?: SpacingBox }>({});
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(`[data-node="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
      if (!el) { setBox({}); return; }
      const px = (v: string) => Math.round(parseFloat(v) || 0);
      /* The banner pads the items at its EDGES rather than itself, 24px on every side while unset. */
      if (nodeId === 'hero') {
        setBox({ padding: { top: 24, bottom: 24, left: 24, right: 24 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
        return;
      }
      const cs = getComputedStyle(el);
      const p = getComputedStyle(padBoxOf(el));
      setBox({
        padding: { top: px(p.paddingTop), bottom: px(p.paddingBottom), left: px(p.paddingLeft), right: px(p.paddingRight) },
        margin: { top: px(cs.marginTop), bottom: px(cs.marginBottom), left: px(cs.marginLeft), right: px(cs.marginRight) },
      });
    };
    measure();
    const t = window.setTimeout(measure, 60);
    return () => window.clearTimeout(t);
  }, [nodeId, JSON.stringify(deps)]);
  return box;
}

const isH = (s: Side) => s === 'left' || s === 'right';
/* ⚠️ EVERY SIDE IS px. Left and right used to be a PERCENTAGE of the parent, which is why the panel
   had to print its units in a caption and why one control carried two scales. An admin setting the room
   inside a card is thinking in the same unit on all four sides, and a % that reads 3 while painting 32
   pixels is a number that answers a question nobody asked. The switch reaches the nine places that
   emitted the horizontal sides — see the px bullet in CLAUDE.md, including the banner templates, whose
   authored percentages were converted at the width they were designed against. */
const unitOf = (_s: Side) => 'px';
const maxOf = (_s: Side) => 200;
const AXES = { v: ['top', 'bottom'] as Side[], h: ['left', 'right'] as Side[] };

/* ── The band the hovered side owns, drawn over the canvas ──────────────────────────────────────
 *
 * ⚠️ MAGENTA, the same `#FF24BD` the gap strips use: this product already says "space you are
 * setting" in that colour, and a second colour for the same idea would be a second language.
 * ⚠️ A band with no thickness is drawn as a 2px line rather than skipped — hovering "top" when the
 * top is 0 still has to answer WHICH edge that is, which is exactly when you need to be told. */
function SpacingHint({ nodeId, ring, side }: { nodeId: string; ring: Ring; side: Side }) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const el = document.querySelector(`[data-node="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
    if (!el) { setBox(null); return; }
    const target = ring === 'padding' ? padBoxOf(el) : el;
    const r = target.getBoundingClientRect();
    const cs = getComputedStyle(target);
    const v = (k: string) => Math.max(0, parseFloat(cs[k as 'marginTop']) || 0);
    const thin = (n: number) => Math.max(n, 2);
    if (ring === 'margin') {
      const m = { top: v('marginTop'), right: v('marginRight'), bottom: v('marginBottom'), left: v('marginLeft') };
      setBox(
        side === 'top' ? { left: r.left, top: r.top - m.top, width: r.width, height: thin(m.top) }
        : side === 'bottom' ? { left: r.left, top: r.bottom, width: r.width, height: thin(m.bottom) }
        : side === 'left' ? { left: r.left - m.left, top: r.top, width: thin(m.left), height: r.height }
        : { left: r.right, top: r.top, width: thin(m.right), height: r.height },
      );
      return;
    }
    const p = { top: v('paddingTop'), right: v('paddingRight'), bottom: v('paddingBottom'), left: v('paddingLeft') };
    setBox(
      side === 'top' ? { left: r.left, top: r.top, width: r.width, height: thin(p.top) }
      : side === 'bottom' ? { left: r.left, top: r.bottom - p.bottom, width: r.width, height: thin(p.bottom) }
      : side === 'left' ? { left: r.left, top: r.top, width: thin(p.left), height: r.height }
      : { left: r.right - p.right, top: r.top, width: thin(p.right), height: r.height },
    );
  }, [nodeId, ring, side]);
  if (!box) return null;
  return createPortal(
    <span
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      className="pointer-events-none fixed z-[9999] bg-[#FF24BD]/25 outline outline-1 outline-[#FF24BD]"
    />,
    document.body,
  );
}

/* ── One side, as a real field ──────────────────────────────────────────────────────────────────
 *
 * ⚠️ It LOOKS like an input — a bordered box at the product's 32px control height — where it used to
 * be bare text that only revealed a border on hover. A number you can edit and a number you can only
 * read are the same picture until you touch one, and the admin reading this panel has no reason to
 * touch anything to find out which it is.
 * ⚠️ Click to type, drag sideways to scrub, and the two do not fight: a press becomes a scrub only
 * after the pointer has travelled 3px. Under that it is a plain click and the field takes focus, or a
 * control that looks like a field would refuse to be typed in.
* ⚠️ `lead` is the glyph INSIDE the box saying which side or axis it is, rather than a label beside
 * it — that is what lets a row stay one line of equal boxes at any sidebar width.
 * ⚠️ The UNIT is a divided cell on the right, not a word floating beside the number: the box then reads
 * as two parts — the thing you type in, and the thing it is measured in — and the typing part gets the
 * width, which is the part being used. A bare "24 px" centred in a box is one blob of grey text.
 * ⚠️ The value is ALWAYS at full strength. It used to go grey whenever nobody had set that side, to say
 * "this is the element's own" — true, secondary, and indistinguishable from a disabled field, which is
 * how a panel of eight real inputs came to look switched off. The number is correct either way; the
 * only thing the grey carried was who put it there.
 * ⚠️ Every box is `flex-1` or a grid cell, never a fixed width, so a row always fills the panel
 * however wide the admin has dragged it. */
function SideField({ value, own, unit, max, lead, onSet, onHover, placeholder }: {
  value: number | null; own: boolean; unit: string; max: number; lead?: ReactNode;
  onSet: (v: number) => void; onHover?: (on: boolean) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(0, Math.min(max, unit === '%' ? Math.round(n * 10) / 10 : Math.round(n)));
  const onDown = (e: React.PointerEvent) => {
    const start = { x: e.clientX, v: value ?? 0, moved: false };
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - start.x;
      if (!start.moved && Math.abs(d) < 3) return;
      start.moved = true;
      ref.current?.blur();
      setTyping(null);
      onSet(clamp(start.v + d * (unit === '%' ? 0.1 : 1)));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label
      className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded border border-[#DFE5ED] bg-white transition-colors focus-within:border-[#3D8BD0] focus-within:ring-2 focus-within:ring-[#3D8BD0]/15 hover:border-[#C3CBD6]"
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
    >
      {lead && <span className="flex flex-shrink-0 items-center pl-2 text-[#94A3B8]">{lead}</span>}
      <input
        ref={ref}
        value={typing ?? (value === null ? '' : String(value))}
        placeholder={placeholder}
        onPointerDown={onDown}
        onChange={(e) => { setTyping(e.target.value); const n = Number(e.target.value); if (Number.isFinite(n) && e.target.value !== '') onSet(clamp(n)); }}
        onBlur={() => setTyping(null)}
        /* `ew-resize` is the whole hint that this number drags — the cursor every design tool uses for
           a scrubber, and it costs no pixels on a control this small. */
        className="w-full min-w-0 cursor-ew-resize bg-transparent px-2 text-[12.5px] font-medium tabular-nums text-[#364658] outline-none placeholder:text-[11px] placeholder:font-normal placeholder:text-[#B3BECC] focus:cursor-text"
      />
      <span className="flex h-full flex-shrink-0 items-center border-l border-[#EEF1F5] bg-[#F8FAFC] px-1.5 text-[10px] font-medium text-[#94A3B8]">{unit}</span>
    </label>
  );
}

/** The ring's ONE chain, at the top right of its header.
 *
 * ⚠️ It was TWO — one per axis, each with its own arrow glyph beside it. Two chains asked the admin
 * to hold a distinction the control does not act on: breaking EITHER of them already opened all four
 * sides (any chain broken means the ring's sides are not all the same), so the second button only
 * ever changed which pair stayed tied inside a view you had reached with the first. One chain, one
 * statement: the sides move together, or they do not.
 * ⚠️ It is the ring's DISCLOSURE as well as its setting, which is why it sits on the header rather
 * than between the fields — there is no "between" in a row of four, and in the box layout the two
 * points a chain would want are already taken by boxes. */
function LinkToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      title={on ? 'All sides move together — click to set them apart' : 'Sides are set one by one — click to tie them together'}
      aria-label="Sides linked"
      aria-pressed={on}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`flex size-6 items-center justify-center rounded transition-colors ${
        on ? 'bg-[#EBF5FF] text-[#3D8BD0]' : 'text-[#C3CBD6] hover:bg-[#F1F5F9] hover:text-[#64748B]'
      }`}
    >
      {on ? <Link2 size={12} /> : <Link2Off size={12} />}
    </button>
  );
}

export function SpacingMatrix({ style, onChange, only, resting, nodeId }: Props) {
  const [hint, setHint] = useState<{ ring: Ring; side: Side } | null>(null);

  /* ⚠️ An EMPTY box, not ZERO_BOX. Merging over four zeros is what made one control write all four
     sides; merging over nothing leaves the sides you did not touch unset, so the element keeps the
     spacing it already had on those edges. */
  const boxOf = (r: Ring): SpacingBox => (r === 'margin' ? style.margin : style.padding) ?? {};
  /* ⚠️ Unset reads as LINKED — the chain starts on. Typing one number and having both sides of that
     axis move is what almost every real edit wants, and an admin who needs one side uneven breaks the
     chain deliberately. */
  const axisLinked = (r: Ring, a: 'v' | 'h'): boolean =>
    (style as Record<string, unknown>)[`${r}Link${a === 'v' ? 'V' : 'H'}`] !== false;
  /* ⚠️ ONE chain over two stored keys. Both are still written — a node saved while the panel had two
     toggles can be carrying them apart, and reading only one of the pair would silently drop the
     other's state. `linked` therefore asks for BOTH, so a ring left half-tied by the old control
     opens on its four sides rather than claiming to be linked and moving only one axis. */
  const linked = (r: Ring): boolean => axisLinked(r, 'v') && axisLinked(r, 'h');
  const toggleLink = (r: Ring) => {
    const next = !linked(r);
    onChange({ [`${r}LinkV`]: next, [`${r}LinkH`]: next } as Partial<NodeStyle>);
  };

  const ownSet = (r: Ring, s: Side) => boxOf(r)[s] !== undefined;
  /** A side's value as the element really has it: the one set here, else what it rests at. */
  const sideOf = (r: Ring, s: Side): number => {
    const own = boxOf(r)[s];
    if (own !== undefined) return own;
    const rest = resting?.[r]?.[s];
    return Number.isFinite(rest) ? Number(rest) : 0;
  };
  /** The pair's value, or null when its two sides disagree — which is what the "Mixed" hint means. */
  const pairOf = (r: Ring, a: 'v' | 'h'): number | null => {
    const [x, y] = AXES[a];
    return sideOf(r, x) === sideOf(r, y) ? sideOf(r, x) : null;
  };
  const write = (r: Ring, next: SpacingBox) => onChange(r === 'margin' ? { margin: next } : { padding: next });

  /* ⚠️ A linked axis writes BOTH of its sides, and the two axes are never written together: they carry
     different units, so copying 24 from a px side into a % side would set a quarter of the parent. */
  const setSide = (r: Ring, side: Side, v: number) => {
    const box = boxOf(r);
    const a = isH(side) ? 'h' : 'v';
    if (!axisLinked(r, a)) { write(r, { ...box, [side]: v }); return; }
    const [x, y] = AXES[a];
    write(r, { ...box, [x]: v, [y]: v });
  };
  const setPair = (r: Ring, a: 'v' | 'h', v: number) => {
    const [x, y] = AXES[a];
    write(r, { ...boxOf(r), [x]: v, [y]: v });
  };

  const rings: Ring[] = only === 'margin' ? ['margin'] : only === 'padding' ? ['padding'] : ['padding', 'margin'];
  const hover = (r: Ring, s: Side) => (on: boolean) => setHint(on ? { ring: r, side: s } : null);

  const field = (r: Ring, s: Side, lead?: ReactNode) => (
    <SideField
      key={`${r}-${s}`}
      value={sideOf(r, s)}
      own={ownSet(r, s)}
      unit={unitOf(s)}
      max={maxOf(s)}
      lead={lead}
      onSet={(v) => setSide(r, s, v)}
      onHover={hover(r, s)}
    />
  );

  /** The ring's name and its chain — ONE header for both views, so they cannot drift apart. */
  const head = (r: Ring, trailing?: ReactNode) => (
    <div className="mb-1.5 flex items-center gap-1">
      <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[#7B8FA5]">{r === 'margin' ? 'Space around' : 'Space inside'}</span>
      <LinkToggle on={linked(r)} onToggle={() => toggleLink(r)} />
      {trailing}
    </div>
  );

  /* ⚠️ THE LINK IS THE DISCLOSURE. There is no chevron: breaking the chain is already the statement
     that this ring's sides are not all the same, so the four boxes appear then and only then, and
     tying it folds them back to two. A chevron beside the chain was a second control for one idea —
     you could open the four sides with the pairs still tied, which is four fields that behave like
     two, and you could unlink while the sides that no longer move together were hidden. */
  const apart = (r: Ring) => !linked(r);

  /* ── TWO FIELDS, the four sides once a chain is broken ──────────────────────────────────────────
   * Two numbers on arrival instead of eight, which is what a linked pair of pairs already is. The
   * chevron opens the four, laid out WHERE THEY ARE around a plate rather than as a list: the one
   * thing a non-designer gets from this control is which box is which edge, and four rows labelled
   * top / right / bottom / left is a list you have to read. */
  const twoFields = (r: Ring) => (
    <div key={r} className="mt-3">
      {head(r)}
      {apart(r) ? (
        /* ⚠️ No glyphs in here: a box above the plate IS the top, so an arrow inside it labels what its
           position already says, and the width it costs is width the number wanted. */
        <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2">
          <div className="flex">{field(r, 'top')}</div>
          <div className="mt-1.5 flex items-center gap-1.5">
            {field(r, 'left')}
            <span className="flex h-8 flex-1 items-center justify-center rounded bg-[#EBF5FF] text-[9px] font-semibold uppercase tracking-wider text-[#3D8BD0]">Element</span>
            {field(r, 'right')}
          </div>
          <div className="mt-1.5 flex">{field(r, 'bottom')}</div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          {/* ⚠️ These two write the PAIR whatever the chains say — they ARE the pair. A chain broken in
              the open view leaves its sides uneven, and then the collapsed field reads "Mixed" rather
              than picking one of the two to report as though they agreed. */}
          <SideField
            value={pairOf(r, 'v')}
            own={ownSet(r, 'top') || ownSet(r, 'bottom')}
            unit="px" max={200} placeholder="Mixed"
            lead={<MoveVertical size={11} />}
            onSet={(v) => setPair(r, 'v', v)}
            onHover={hover(r, 'top')}
          />
          <SideField
            value={pairOf(r, 'h')}
            own={ownSet(r, 'left') || ownSet(r, 'right')}
            unit="px" max={200} placeholder="Mixed"
            lead={<MoveHorizontal size={11} />}
            onSet={(v) => setPair(r, 'h', v)}
            onHover={hover(r, 'left')}
          />
        </div>
      )}
    </div>
  );

  return (
    <div>
      {rings.map(twoFields)}
      {nodeId && hint && <SpacingHint nodeId={nodeId} ring={hint.ring} side={hint.side} />}
    </div>
  );
}


/* ── SPACING IN FOUR SIZES, with Custom per ring ──────────────────────────────────────────────────
 *
 * What an admin who is not a designer actually decides: a little room or a lot, inside the block and
 * around it. Nobody should have to know that the first is padding and the second margin.
 *
 * S · M · L · XL = 4 · 8 · 12 · 16 px (Zeni, 5 Oct 2026 — re-scaled from 4/6/8/12 so a block's own
 * default lands on a real tab: action and data cards rest at a 16px inset, tiles at 12).
 *
 * ⚠️ AN UNTOUCHED BLOCK LIGHTS ITS DEFAULT. With nothing set, the tab matching what the block already
 * has is selected, read from the MEASURED resting spacing — so the admin starts from the truth and
 * changes it, rather than seeing four unlit tabs over a card that plainly has room in it. Inside is
 * matched on the HORIZONTAL inset (left = right): that is the edge-to-content distance a reader sees,
 * and card headers carry slightly different top/bottom (14/10) for optical balance. A block whose
 * default fits no size (a section's 24px) lights none. Clicking the default tab does nothing — it is
 * already the value; clicking a tab you SET clears it back to the default.
 *
 * ⚠️ Inside moves all four sides. Around moves only TOP and BOTTOM — a left/right margin on a card in
 * a row takes width from the row, so the last card wraps. The sides are reachable through Custom.
 *
 * ⚠️ CUSTOM is an icon on each ring's own heading, opening that ring's four sides — Top · Right ·
 * Bottom · Left, in CSS order. It opens by itself when the ring already carries values no size
 * describes, so nothing set is ever hidden. The old two-field "Exact values" matrix is gone from here. */
const SIZES = { S: 4, M: 8, L: 12, XL: 16 } as const;
type SizeKey = keyof typeof SIZES;
type Size = SizeKey | 'auto' | 'custom';
const SIZE_NAME: Record<SizeKey, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' };
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

function sizeOfRing(b: SpacingBox | undefined, ring: Ring): Size {
  if (!b || Object.values(b).every((v) => v === undefined)) return 'auto';
  for (const k of Object.keys(SIZES) as SizeKey[]) {
    const v = SIZES[k];
    if (ring === 'padding' && SIDES.every((s) => b[s] === v)) return k;
    if (ring === 'margin' && b.top === v && b.bottom === v && !b.left && !b.right) return k;
  }
  return 'custom';
}

/** The size a block's RESTING spacing already matches, or null. */
function restingSize(b: SpacingBox | undefined, ring: Ring): SizeKey | null {
  if (!b) return null;
  for (const k of Object.keys(SIZES) as SizeKey[]) {
    const v = SIZES[k];
    if (ring === 'padding' && b.left === v && b.right === v) return k;
    if (ring === 'margin' && b.top === v && b.bottom === v) return k;
  }
  return null;
}

export function SimpleSpacing(props: Props) {
  const { style, onChange, only, resting } = props;
  const own = { padding: sizeOfRing(style.padding, 'padding'), margin: sizeOfRing(style.margin, 'margin') };
  /* What is lit: the size somebody set, else the size the block already rests at. `fromRest` marks
     the second, so clicking it is a no-op rather than a "clear". */
  const lit = (ring: Ring): { key: Size | null; fromRest: boolean } =>
    own[ring] === 'auto'
      ? { key: restingSize(resting?.[ring], ring), fromRest: true }
      : { key: own[ring], fromRest: false };
  const sizes = own;
  const [custom, setCustom] = useState<Record<Ring, boolean>>({
    padding: sizes.padding === 'custom',
    margin: sizes.margin === 'custom',
  });
  const write = (ring: Ring, box: SpacingBox | undefined) =>
    onChange((ring === 'padding' ? { padding: box } : { margin: box }) as Partial<NodeStyle>);
  const pick = (ring: Ring, k: SizeKey) => {
    const l = lit(ring);
    if (l.key === k) { if (!l.fromRest) write(ring, undefined); return; }
    const v = SIZES[k];
    write(ring, ring === 'padding' ? { top: v, right: v, bottom: v, left: v } : { top: v, bottom: v });
  };
  const setSide = (ring: Ring, side: Side, raw: string) => {
    const cur = { ...((ring === 'padding' ? style.padding : style.margin) ?? {}) };
    if (raw.trim() === '') delete cur[side];
    else cur[side] = Math.max(0, Math.min(200, Math.round(Number(raw) || 0)));
    write(ring, Object.values(cur).some((v) => v !== undefined) ? cur : undefined);
  };

  const ringRow = (ring: Ring, label: string, hint: string) => {
    const box = (ring === 'padding' ? style.padding : style.margin) ?? {};
    const open = custom[ring] || sizes[ring] === 'custom';
    return (
      <div key={ring} className="mt-3 first:mt-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[12px] font-medium text-[#364658]" title={hint}>{label}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#9CA3AF]">{hint}</span>
          <button
            onClick={() => setCustom((c) => ({ ...c, [ring]: !open }))}
            aria-pressed={open}
            title={`Custom — set each side of the ${ring === 'padding' ? 'space inside' : 'space around'}`}
            className={`flex size-6 flex-shrink-0 items-center justify-center rounded transition-colors ${
              open ? 'bg-[#EBF5FF] text-[#3D8BD0]' : 'text-[#7B8FA5] hover:bg-[#F3F4F6] hover:text-[#364658]'
            }`}
          ><Settings2 size={14} /></button>
        </div>
        <div className="pill-track">
          {/* ⚠️ INSTANT tooltips (delay 0), not `title` — a letter says nothing about pixels, and the
              number is the answer to the only question you hover these to ask. `asChild` keeps the
              button the track's direct child, which is what `.pill-track > button` styles. */}
          {(Object.keys(SIZES) as SizeKey[]).map((k) => {
            const l = lit(ring);
            const on = l.key === k;
            return (
              <Tooltip key={k} delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    aria-pressed={on}
                    aria-label={`${SIZE_NAME[k]}, ${SIZES[k]}px`}
                    onClick={() => pick(ring, k)}
                    className="flex-1 rounded py-1 text-[12px] font-medium text-[#7B8FA5]"
                  >{k}</button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {SIZE_NAME[k]} · <span className="font-semibold">{SIZES[k]}px</span>
                  {on && l.fromRest && <span className="text-white/70"> · default</span>}
                  {on && !l.fromRest && <span className="text-white/70"> · click to reset</span>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {open && (
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {SIDES.map((s) => {
              const own = box[s];
              const rest = resting?.[ring]?.[s];
              return (
                <label key={s} className="flex flex-col items-center gap-1">
                  <span className="flex h-8 w-full items-center rounded border border-[#DFE5ED] bg-white pr-1.5 focus-within:border-[#3D8BD0] focus-within:ring-1 focus-within:ring-[#3D8BD0]">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={own ?? ''}
                      placeholder={rest !== undefined ? String(Math.round(rest)) : '0'}
                      onChange={(e) => setSide(ring, s, e.target.value)}
                      className="w-full min-w-0 bg-transparent pl-2 text-[12px] tabular-nums text-[#364658] outline-none [appearance:textfield] placeholder:text-[#B0BAC6] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-[10px] text-[#9CA3AF]">px</span>
                  </span>
                  <span className="text-[10.5px] capitalize text-[#7B8FA5]">{s}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {only !== 'margin' && ringRow('padding', 'Space inside', 'Edge to content')}
      {only !== 'padding' && ringRow('margin', 'Space around', 'Above and below')}
    </div>
  );
}
