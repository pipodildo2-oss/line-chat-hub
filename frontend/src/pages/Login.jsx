import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, ArrowRight } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/login', { email, password });
      login(data.token, data.agent);
      navigate('/inbox');
    } catch {
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
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
            <img src="/logo.png" alt="Alpha" className="w-11 h-11 rounded-xl shadow-lg shadow-aurora-teal/20" />
            <div>
              <h1 className="font-brand font-semibold text-white text-xl leading-tight tracking-tight">Alpha Chat</h1>
              <p className="text-white/40 text-xs">By BBB888</p>
            </div>
          </div>

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
              className="group relative mt-1 bg-gradient-to-r from-aurora-tealDeep to-aurora-purple text-white rounded-lg py-2.5 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-aurora-teal/20"
            >
              {loading ? 'กำลังเข้าสู่ระบบ...' : (
                <>เข้าสู่ระบบ <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>
              )}
            </button>
          </form>
        </div>
        <p className="text-center text-white/20 text-xs mt-5">Alpha Chat — Unified messaging workspace</p>
      </div>
    </div>
  );
}
