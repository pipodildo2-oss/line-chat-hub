import { useState, useRef, useEffect, useMemo } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isToday, format } from 'date-fns';

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function toISO(d) { return format(d, 'yyyy-MM-dd'); }
function parseISO(s) {
  // Plain 'YYYY-MM-DD' parsed as LOCAL midnight (not UTC, unlike `new
  // Date('YYYY-MM-DD')`) — otherwise a negative timezone offset shifts the
  // calendar's displayed month back a day for anyone west of UTC.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Shared click-click range calendar: click one day to select just that day
// (applied immediately — closing right here is a valid single-day pick),
// click a second, different day to extend it into a range (applied on that
// second click, which also closes the popover). Clicking the SAME day again
// re-confirms the single-day selection and closes.
//
// Pure calendar, no presets inside — each page keeps its own preset pill row
// alongside this (the original always-visible pills UI), and this replaces
// only the old two native <input type=date> fields for picking a custom
// range. See Dashboard.jsx, Report.jsx (x3) and Upsell.jsx (x3) for call sites.
//
// Props:
//   from, to       ISO 'YYYY-MM-DD' strings, or null/null for "no filter"
//   label          precomputed display string for the trigger button (each
//                  page already computes this for its own captions — reused
//                  here rather than duplicating the formatting logic)
//   onCustomRange  (fromISO, toISO) => void — the calendar always knows both
//                  ends of a pick at once, so there's a single callback
//                  rather than the old two-call onCustom('from'|'to', value)
export default function DateRangePicker({ from, to, label, onCustomRange }) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => (to ? parseISO(to) : new Date()));
  const [pendingStart, setPendingStart] = useState(null); // ISO string mid-sequence, else null
  const [hoverDay, setHoverDay] = useState(null); // ISO string, live preview while pendingStart is set
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Every time it opens, start a fresh click sequence and jump the visible
  // month back to wherever the current selection is — otherwise reopening
  // after browsing months away (without picking anything) leaves it stranded
  // on that far-off month next time.
  useEffect(() => {
    if (open) {
      setViewMonth(to ? parseISO(to) : (from ? parseISO(from) : new Date()));
      setPendingStart(null);
      setHoverDay(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function dayClick(dateObj) {
    const iso = toISO(dateObj);
    if (!isSameMonth(dateObj, viewMonth)) setViewMonth(dateObj);
    if (!pendingStart) {
      setPendingStart(iso);
      setHoverDay(null);
      onCustomRange(iso, iso);
    } else {
      const a = pendingStart, b = iso;
      onCustomRange(a <= b ? a : b, a <= b ? b : a);
      setPendingStart(null);
      setHoverDay(null);
      setOpen(false);
    }
  }

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth));
    const end = endOfWeek(endOfMonth(viewMonth));
    const list = [];
    for (let d = start; d <= end; d = addDays(d, 1)) list.push(d);
    return list;
  }, [viewMonth]);

  // While a click sequence is in progress, the highlighted range is a live
  // preview (anchor → hovered day, or just the anchor alone before any
  // hover) rather than the committed from/to — this is what lets the second
  // click's range extend visually as you move the mouse before clicking it.
  const previewing = pendingStart != null;
  const rangeA = previewing ? pendingStart : from;
  const rangeB = previewing ? (hoverDay || pendingStart) : to;
  const effStart = rangeA && rangeB ? (rangeA <= rangeB ? rangeA : rangeB) : rangeA;
  const effEnd = rangeA && rangeB ? (rangeA <= rangeB ? rangeB : rangeA) : rangeA;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-1.5 transition-colors ${
          open ? 'border-aurora-teal text-aurora-tealDeep dark:text-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:border-gray-400 dark:hover:border-slate-500'
        }`}
      >
        <CalendarIcon size={14} className="text-gray-400 dark:text-slate-500 flex-shrink-0" />
        {label}
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-4 w-72">
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={() => setViewMonth(m => subMonths(m, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                {MONTHS_TH[viewMonth.getMonth()]} {viewMonth.getFullYear() + 543}
              </span>
              <button type="button" onClick={() => setViewMonth(m => addMonths(m, 1))} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS_TH.map(w => (
                <div key={w} className="text-center text-xs text-gray-400 dark:text-slate-500 font-medium">{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {days.map(d => {
                const iso = toISO(d);
                const outside = !isSameMonth(d, viewMonth);
                const highlighted = effStart != null && iso >= effStart && iso <= effEnd;
                const isEdge = iso === effStart || iso === effEnd;
                const today = isToday(d);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => dayClick(d)}
                    onMouseEnter={() => { if (previewing) setHoverDay(iso); }}
                    className={`h-8 w-8 flex items-center justify-center text-sm rounded-lg transition-colors ${
                      outside ? 'text-gray-300 dark:text-slate-600' : 'text-gray-700 dark:text-slate-200'
                    } ${
                      isEdge
                        ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white font-semibold'
                        : highlighted
                          ? 'bg-aurora-teal/15 dark:bg-aurora-teal/20'
                          : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                    } ${today && !isEdge ? 'ring-1 ring-inset ring-aurora-teal' : ''}`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
