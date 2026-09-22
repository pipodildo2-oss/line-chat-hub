import axios from 'axios';
import { ImageOff, AlertCircle } from 'lucide-react';

// Tells the backend that an image wouldn't render here, and why — see
// POST /api/messages/image-failure for the reasoning. A whole class of these
// never reaches the server on its own: the fetch can come back 200 with a
// valid file and the picture still won't display, so the only place the truth
// exists is in the browser. Fire-and-forget and never awaited; a failed report
// is silently dropped rather than becoming a second error on the page.
//
// Deduplicated per page load because these render inside lists that re-render
// on every socket event — without it one stuck thumbnail would report itself
// continuously.
const reported = new Set();
export function reportImageFailure(info) {
  const key = `${info.kind}:${info.messageId}:${info.status}`;
  if (reported.has(key)) return;
  reported.add(key);
  axios.post('/api/messages/image-failure', info).catch(() => { /* diagnostics are best effort */ });
}

// Placeholder for a customer-sent photo/video that can't be displayed.
//
// These used to render as a bare "[Image]" / "[รูป]" string, which read like a
// glitch — agents reported it as a bug repeatedly, especially on the อัพเซลล์
// ตรวจสอบ page where a submission is often reviewed days after the customer
// sent the proof image. Usually it isn't a glitch at all: LINE's Content API
// only keeps a message's content for about two weeks, and this app only
// started saving its own permanent copy at ingestion time in Sep 2026, so
// every customer image from before that which is now older than LINE's window
// is genuinely gone — nothing to load, no amount of reloading will bring it
// back (see backend/src/lib/imageBackfill.js).
//
// `expired` (the backend answers 410 Gone for exactly this case, as opposed to
// a 5xx it might recover from) is what separates "this is permanently gone,
// stop worrying about it" from "this failed to load, try again" — worth
// keeping distinct, since only one of the two is ever worth reporting.
// Picks the src for an agent-sent image.
//
// Prefers this app's OWN relative route over the url stored on the row, which
// is the opposite of what it used to do. metadata.url is absolute and was
// frozen at send time from `${req.protocol}://${req.get('host')}` — whatever
// origin that particular agent happened to be using. Any row whose url got
// baked with a host that no longer resolves from the browser (an http:// one
// that mixed-content blocks, a hostname only reachable from elsewhere, an
// origin the app has since moved off) renders as a broken image with no
// request ever reaching the server — which is exactly why these failures were
// invisible in the deploy logs while agents kept seeing them.
//
// A relative path can't have that problem: it always resolves against the
// origin the page is already being served from. /api/messages/image/:id then
// resolves the file from the row's own imageData column.
//
// Two exceptions fall back to the stored url: an optimistic bubble that hasn't
// been sent yet (its url is a local blob/data one and there's no server row
// to ask for), and a quick-reply message from before sends recorded their own
// imageData — for those the own-route 404s and the caller retries with
// `useStored`.
export function agentImageSrc(msg, storedUrl, useStored) {
  if (storedUrl && /^(blob:|data:)/i.test(storedUrl)) return storedUrl;
  if (!useStored && msg?.id) return `/api/messages/image/${msg.id}`;
  return storedUrl || (msg?.id ? `/api/messages/image/${msg.id}` : null);
}

export default function MissingMedia({ expired, size = 'md', label = 'รูป' }) {
  const Icon = expired ? ImageOff : AlertCircle;
  const small = size === 'sm';
  return (
    <div
      title={expired
        ? `${label}นี้หมดอายุแล้ว — LINE เก็บไฟล์ไว้ประมาณ 2 สัปดาห์ จึงไม่สามารถแสดงได้อีก`
        : `โหลด${label}ไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง`}
      className={`${small ? 'w-20 h-20 gap-0.5' : 'w-40 h-32 gap-1.5'} rounded-lg flex flex-col items-center justify-center text-center px-2 bg-gray-100 dark:bg-slate-800 border border-dashed border-gray-300 dark:border-slate-700 text-gray-400 dark:text-slate-500`}
    >
      <Icon className={small ? 'w-4 h-4' : 'w-6 h-6'} />
      <span className={small ? 'text-[9px] leading-tight' : 'text-xs leading-tight'}>
        {expired ? `${label}หมดอายุ` : `โหลด${label}ไม่ได้`}
      </span>
      {!small && expired && (
        <span className="text-[10px] leading-tight text-gray-400 dark:text-slate-600">LINE เก็บไฟล์ไว้ ~2 สัปดาห์</span>
      )}
    </div>
  );
}
