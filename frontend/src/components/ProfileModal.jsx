import { useState, useRef } from 'react';
import axios from 'axios';
import { X, Check, Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// Keeps this in sync with the ~10MB cap LINE itself enforces on original
// images (see imageStorage.js / line.service.js) — no reason to let an
// avatar upload be more permissive than message attachments already are.
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export default function ProfileModal({ onClose }) {
  const { agent, updateAgent } = useAuth();
  const [name, setName] = useState(agent?.name || '');
  const [language, setLanguage] = useState(agent?.language === 'en' ? 'en' : 'th');
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);

  function pickAvatarFile() {
    fileInputRef.current?.click();
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('กรุณาเลือกไฟล์รูปภาพ');
    if (file.size > MAX_AVATAR_BYTES) return setError('ไฟล์รูปภาพต้องมีขนาดไม่เกิน 10MB');

    setError('');
    const reader = new FileReader();
    reader.onload = async () => {
      setAvatarUploading(true);
      try {
        const { data } = await axios.patch('/api/agents/me/avatar', { imageData: reader.result });
        updateAgent(data);
      } catch (err) {
        setError(err.response?.data?.error || 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ');
      } finally {
        setAvatarUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  const fieldCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-slate-400 mb-1.5 block';

  async function handleSave() {
    setError(''); setSaved(false);
    if (showPasswordFields && newPassword) {
      if (newPassword.length < 6) return setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
      if (newPassword !== confirmPassword) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    }
    setSaving(true);
    try {
      const { data } = await axios.patch('/api/agents/me', { name, language });
      updateAgent(data);
      if (showPasswordFields && newPassword) {
        await axios.patch('/api/agents/me/password', { currentPassword, newPassword });
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        setShowPasswordFields(false);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-100">โปรไฟล์</h3>
            <p className="text-xs text-slate-500 mt-0.5">จัดการโปรไฟล์และการเข้าสู่ระบบของคุณ</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={pickAvatarFile}
            disabled={avatarUploading}
            className="relative w-14 h-14 rounded-full flex-shrink-0 group focus:outline-none focus:ring-2 focus:ring-aurora-teal rounded-full"
            title="เปลี่ยนรูปโปรไฟล์"
          >
            {agent?.avatarUrl ? (
              <img src={agent.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-lg font-semibold">
                {agent?.name?.[0]?.toUpperCase() || 'A'}
              </div>
            )}
            <div className={`absolute inset-0 rounded-full bg-black/50 flex items-center justify-center transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {avatarUploading ? <Loader2 size={18} className="text-white animate-spin" /> : <Camera size={16} className="text-white" />}
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          <div className="min-w-0">
            <p className="text-sm text-slate-300 truncate">{agent?.email}</p>
            <p className="text-xs text-slate-500">{agent?.role === 'admin' ? 'Admin' : 'Agent'}</p>
          </div>
        </div>

        {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg mb-3">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>ชื่อ</label>
            <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>ภาษา / Language</label>
            <select className={fieldCls} value={language} onChange={e => setLanguage(e.target.value)}>
              <option value="th">ไทย (Thai)</option>
              <option value="en">English</option>
            </select>
          </div>

          {showPasswordFields ? (
            <div className="space-y-2.5 border border-slate-800 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-300">เปลี่ยนรหัสผ่าน</p>
              <input type="password" className={fieldCls} placeholder="รหัสผ่านปัจจุบัน" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              <input type="password" className={fieldCls} placeholder="รหัสผ่านใหม่" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <input type="password" className={fieldCls} placeholder="ยืนยันรหัสผ่านใหม่" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              <button
                type="button"
                onClick={() => { setShowPasswordFields(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                ยกเลิกการเปลี่ยนรหัสผ่าน
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPasswordFields(true)}
              className="text-sm text-aurora-teal hover:brightness-110 font-medium border border-aurora-teal/30 rounded-lg px-3 py-1.5 hover:bg-aurora-teal/10 transition-colors"
            >
              เปลี่ยนรหัสผ่าน
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {saving ? 'กำลังบันทึก...' : 'Save Profile'}
          </button>
          {saved && <span className="flex items-center gap-1 text-sm text-aurora-teal"><Check size={14} /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  );
}
