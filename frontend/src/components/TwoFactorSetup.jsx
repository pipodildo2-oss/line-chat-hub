import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Check, Copy, Loader2, ShieldCheck } from 'lucide-react';

// The QR-scan → confirm-code → show-backup-codes flow for turning on TOTP
// 2FA, shared by two very different callers:
//   - ProfileModal.jsx: an agent already fully logged in, turning this on
//     voluntarily. Uses the normal axios Authorization header — no
//     `pendingToken` prop needed.
//   - Login.jsx: someone mid-login who the org (Settings > ระบบ) requires
//     to set up 2FA before they can go any further. Has no session yet, so
//     it passes `pendingToken` (from POST /api/auth/login's requires2FA
//     response) instead — see routes/twoFactor.js's resolveSetupSubject for
//     how the backend accepts either.
//
// Both paths hit the exact same two endpoints (setup-init, setup-confirm),
// so this component doesn't need to know which caller it's in beyond that.
//
// `forceDark`: Login.jsx is intentionally always-dark and never toggles
// with the rest of the app's light/dark mode (see Sidebar.jsx — same
// convention), so its own classes never carry a `dark:` prefix at all. The
// light-first + `dark:`-override classes below are correct for
// ProfileModal's context (which DOES follow the app's color mode) but would
// render as a stray light-mode box on Login's always-dark card if an agent
// had switched their OWN color mode to light before logging out — the
// `dark` class on <html> would then be absent even on the login screen.
// `forceDark` swaps in fixed dark classes matching Login's own palette
// instead of relying on that toggle at all.
export default function TwoFactorSetup({ pendingToken, onComplete, onCancel, forceDark = false }) {
  const [step, setStep] = useState('loading'); // loading | scan | error | backupCodes
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [backupCodes, setBackupCodes] = useState([]);
  const [copied, setCopied] = useState(false);
  const [loginResult, setLoginResult] = useState(null); // { token, agent } — only set on the pendingToken path
  const initRan = useRef(false);

  useEffect(() => {
    if (initRan.current) return; // StrictMode double-invoke guard — setup-init issues a fresh secret each call, so running it twice would show a QR for one secret and confirm against another
    initRan.current = true;
    axios.post('/api/auth/2fa/setup-init', pendingToken ? { pendingToken } : {})
      .then(({ data }) => {
        setQrCodeDataUrl(data.qrCodeDataUrl);
        setSecret(data.secret);
        setStep('scan');
      })
      .catch(() => setStep('error'));
  }, [pendingToken]);

  async function handleConfirm(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await axios.post('/api/auth/2fa/setup-confirm', {
        code,
        ...(pendingToken ? { pendingToken } : {}),
      });
      setBackupCodes(data.backupCodes);
      if (data.token) setLoginResult({ token: data.token, agent: data.agent });
      setStep('backupCodes');
    } catch (err) {
      setError(err.response?.data?.error || 'ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  }

  function copyBackupCodes() {
    navigator.clipboard?.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const c = forceDark ? {
    mutedText: 'text-white/50',
    faintText: 'text-white/30',
    secondaryBtn: 'text-white/50 hover:text-white/80',
    input: 'border border-white/10 bg-white/[0.03] text-white placeholder:text-white/25 focus:ring-2 focus:ring-aurora-teal/40 focus:border-aurora-teal/40',
    codeBox: 'bg-white/[0.03] border border-white/10 text-white/90',
    cancelBtn: 'text-white/50 hover:text-white/80',
  } : {
    mutedText: 'text-gray-500 dark:text-slate-400',
    faintText: 'text-gray-400 dark:text-slate-500',
    secondaryBtn: 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300',
    input: 'border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-aurora-teal',
    codeBox: 'bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-200',
    cancelBtn: 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200',
  };

  if (step === 'loading') {
    return <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-aurora-teal" size={22} /></div>;
  }

  if (step === 'error') {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-rose-400 mb-3">ไม่สามารถเริ่มตั้งค่าได้ กรุณาลองใหม่อีกครั้ง</p>
        {onCancel && <button onClick={onCancel} className={`text-sm ${c.secondaryBtn}`}>ปิด</button>}
      </div>
    );
  }

  if (step === 'backupCodes') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3 text-aurora-teal">
          <ShieldCheck size={18} />
          <p className="font-medium text-sm">เปิดใช้งาน 2FA สำเร็จ</p>
        </div>
        <p className={`text-xs ${c.mutedText} mb-3`}>
          เก็บรหัสสำรอง 10 ชุดนี้ไว้ในที่ปลอดภัย (เช่น จดไว้หรือพิมพ์เก็บ) — ใช้แทนรหัสจากแอปได้ครั้งเดียวต่อชุด กรณีทำมือถือหาย
          <b> ระบบจะแสดงให้เห็นครั้งนี้ครั้งเดียวเท่านั้น</b>
        </p>
        <div className={`${c.codeBox} rounded-lg p-3 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-sm mb-3`}>
          {backupCodes.map(code => <span key={code}>{code}</span>)}
        </div>
        <button
          type="button"
          onClick={copyBackupCodes}
          className="flex items-center gap-1.5 text-xs text-aurora-teal hover:brightness-110 mb-4"
        >
          {copied ? <><Check size={13} /> คัดลอกแล้ว</> : <><Copy size={13} /> คัดลอกรหัสสำรองทั้งหมด</>}
        </button>
        <button
          type="button"
          onClick={() => onComplete({ backupCodes, ...loginResult })}
          className="w-full bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 transition-all"
        >
          ฉันบันทึกรหัสสำรองแล้ว
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm}>
      <p className={`text-xs ${c.mutedText} mb-3`}>
        สแกน QR code นี้ด้วยแอป Authenticator (Google Authenticator, Authy, 1Password ฯลฯ) แล้วกรอกรหัส 6 หลักที่แอปแสดงเพื่อยืนยัน
      </p>
      {qrCodeDataUrl && (
        <div className="flex justify-center mb-3">
          <img src={qrCodeDataUrl} alt="2FA QR code" className="w-40 h-40 rounded-lg border border-gray-200 dark:border-slate-700 bg-white p-1.5" />
        </div>
      )}
      <p className={`text-[11px] ${c.faintText} text-center mb-4 break-all`}>
        สแกนไม่ได้? กรอกรหัสนี้ด้วยตัวเอง: <span className="font-mono">{secret}</span>
      </p>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
        className={`w-full text-center tracking-[0.4em] text-lg rounded-lg px-3 py-2.5 focus:outline-none mb-2 ${c.input}`}
        required
      />
      {error && <p className="text-rose-400 text-xs mb-2">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          className="flex-1 bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all"
        >
          {submitting ? 'กำลังยืนยัน...' : 'ยืนยัน'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`text-sm px-3 py-2.5 ${c.cancelBtn}`}>
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}
