export const LIFECYCLE_STAGES = [
  { key: 'new', label: 'ใหม่', color: 'bg-sky-100 text-sky-700 border-sky-200' },
  { key: 'contacted', label: 'ติดต่อแล้ว', color: 'bg-violet-100 text-violet-700 border-violet-200' },
  { key: 'qualified', label: 'มีคุณสมบัติ', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  { key: 'negotiation', label: 'เจรจา', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'won', label: 'ปิดการขาย', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'lost', label: 'ไม่สำเร็จ', color: 'bg-rose-100 text-rose-700 border-rose-200' },
];

export function stageInfo(key) {
  return LIFECYCLE_STAGES.find(s => s.key === key) || LIFECYCLE_STAGES[0];
}

export const STATUS_COLORS = {
  open: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  stopped: 'bg-indigo-100 text-indigo-700',
  closed: 'bg-gray-100 text-gray-600',
};

// Leading-dot color for the same open/pending/stopped/closed badges above —
// a small solid circle before the label, same convention as the
// online/break/offline status dot in Sidebar.jsx.
export const STATUS_DOT_COLORS = {
  open: 'bg-emerald-500',
  pending: 'bg-amber-500',
  stopped: 'bg-indigo-500',
  closed: 'bg-gray-400',
};

export const TAG_COLOR_PRESETS = ['#005BFF', '#7CFF6B', '#7EC7FF', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444', '#64748b'];
