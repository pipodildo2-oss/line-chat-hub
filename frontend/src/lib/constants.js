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
  closed: 'bg-gray-100 text-gray-600',
};

export const TAG_COLOR_PRESETS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#8b5cf6', '#64748b'];
