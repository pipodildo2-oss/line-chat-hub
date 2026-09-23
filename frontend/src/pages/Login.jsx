import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail, ArrowRight, Clock, ShieldCheck, KeyRound } from 'lucide-react';
import TwoFactorSetup from '../components/TwoFactorSetup';
import OtpBoxInput from '../components/OtpBoxInput';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  // AfkTracker.jsx sends an idle agent here with ?reason=afk right after
  // logging them out — a plain "session expired"-style redirect wouldn't
  // explain to someone who never touched the logout button why they're
  // suddenly looking at the login screen again.
  const [searchParams] = useSearchParams();
  const afkLogout = searchParams.get('reason') === 'afk';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Password alone isn't always the whole story (see routes/auth.js POST
  // /login): 'password' is the normal form; 'setup' means this account has
  // never set up 2FA but Settings > "ระบบ" now requires it, so setup has to
  // happen right here before login can finish; 'verify' means 2FA is
  // already on for this account and just needs a code.
  const [step, setStep] = useState('password');
  const [pendingToken, setPendingToken] = useState('');
  const [code, setCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/login', { email, password });
      if (data.requires2FA) {
        setPendingToken(data.pendingToken);
        setStep(data.setupRequired ? 'setup' : 'verify');
      } else {
        login(data.token, data.agent);
        navigate('/inbox');
      }
    } catch {
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e, codeOverride) {
    e?.preventDefault();
    // codeOverride lets OtpBoxInput auto-submit the instant its 6th box
    // fills — passing the freshly-completed string directly rather than
    // relying on `code` state, which wouldn't have caught up yet.
    const codeToSend = codeOverride ?? code;
    setVerifying(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/2fa/verify-login', { pendingToken, code: codeToSend });
      login(data.token, data.agent);
      navigate('/inbox');
    } catch (err) {
      setError(err.response?.data?.error || 'รหัสไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    } finally {
      setVerifying(false);
    }
  }

  function handleSetupComplete({ token, agent }) {
    login(token, agent);
    navigate('/inbox');
  }

  function backToPasswordStep() {
    setStep('password');
    setPendingToken('');
    setCode('');
    setError('');
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-[#05060a]">
      {/* Ambient gradient glow — pure CSS, no JS animation loop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-aurora-teal/25 blur-[120px]" />
        <div className="absolute -bottom-40 -right-32 w-[32rem] h-[32rem] rounded-full bg-aurora-purple/40 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      <div className="relative w-full max-w-sm mx-4">
        <div className="backdrop-blur-xl bg-white/[0.04] border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-8">
          <div className="flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="Alpha" className="w-14 h-14 rounded-xl shadow-lg shadow-aurora-teal/20" />
            <div>
              <h1 className="font-brand font-semibold text-white text-xl leading-tight tracking-tight">Alpha Chat</h1>
              <p className="text-white/40 text-xs">By BBB888</p>
            </div>
          </div>

          {afkLogout && step === 'password' && (
            <div className="flex items-start gap-2 bg-orange-400/10 border border-orange-400/20 text-orange-300 text-xs rounded-lg px-3 py-2.5 mb-4">
              <Clock size={14} className="flex-shrink-0 mt-0.5" />
              <span>ระบบออกจากระบบให้อัตโนมัติ เนื่องจากไม่มีการใช้งานเป็นเวลานาน กรุณาเข้าสู่ระบบอีกครั้ง</span>
            </div>
          )}

          {step === 'password' && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-aurora-teal/40 focus:border-aurora-teal/40 transition-colors"
                    placeholder="admin@example.com"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-aurora-teal/40 focus:border-aurora-teal/40 transition-colors"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
              {error && <p className="text-rose-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="group relative mt-1 bg-gradient-to-r from-aurora-teal to-aurora-tealDeep text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-aurora-teal/20"
              >
                {loading ? 'กำลังเข้าสู่ระบบ...' : (
                  <>เข้าสู่ระบบ <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>
                )}
              </button>
            </form>
          )}

          {step === 'setup' && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} className="text-aurora-teal" />
                <p className="text-sm text-white/80">ต้องตั้งค่ายืนยันตัวตนสองขั้นตอนก่อนเข้าใช้งาน</p>
              </div>
              <TwoFactorSetup pendingToken={pendingToken} onComplete={handleSetupComplete} forceDark />
              <button type="button" onClick={backToPasswordStep} className="text-xs text-white/40 hover:text-white/70 mt-4">
                กลับไปหน้าเข้าสู่ระบบ
              </button>
            </div>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-aurora-teal" />
                <p className="text-sm text-white/80">
                  {useBackupCode ? 'กรอกรหัสสำรองชุดใดชุดหนึ่ง' : 'กรอกรหัส 6 หลักจากแอป Authenticator'}
                </p>
              </div>
              {useBackupCode ? (
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    maxLength={11}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white text-center tracking-[0.3em] placeholder:text-white/25 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-aurora-teal/40 focus:border-aurora-teal/40 transition-colors"
                    placeholder="XXXXX-XXXXX"
                    autoFocus
                    required
                  />
                </div>
              ) : (
                <OtpBoxInput
                  value={code}
                  onChange={setCode}
                  onComplete={(full) => handleVerifyCode(null, full)}
                  disabled={verifying}
                  autoFocus
                  forceDark
                />
              )}
              {error && <p className="text-rose-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={verifying || code.length === 0}
                className="group relative mt-1 bg-gradient-to-r from-aurora-teal to-aurora-tealDeep text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-aurora-teal/20"
              >
                {verifying ? 'กำลังยืนยัน...' : 'ยืนยัน'}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => { setUseBackupCode(v => !v); setCode(''); setError(''); }} className="text-white/40 hover:text-white/70">
                  {useBackupCode ? 'ใช้รหัสจากแอปแทน' : 'ใช้รหัสสำรองแทน'}
                </button>
                <button type="button" onClick={backToPasswordStep} className="text-white/40 hover:text-white/70">
                  กลับไปหน้าเข้าสู่ระบบ
                </button>
              </div>
            </form>
          )}
        </div>
        <p className="text-center text-white/20 text-xs mt-5">Alpha Chat — Unified messaging workspace</p>
      </div>
    </div>
  );
}
