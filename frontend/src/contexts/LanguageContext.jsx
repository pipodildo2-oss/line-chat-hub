import { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

// Translation coverage: main navigation chrome, page headers, and common
// action words. Deeper page content (conversation text, form field labels
// further down each page) stays Thai-first for now — this is a starting
// point for bilingual support, not full i18n coverage of every string yet.
const dict = {
  th: {
    nav_group_work: 'งาน',
    nav_group_manage: 'จัดการ',
    nav_inbox: 'กล่องข้อความ',
    nav_dashboard: 'แดชบอร์ด',
    nav_report: 'รายงาน',
    nav_settings: 'ตั้งค่า',
    settings_channels: 'ช่องทาง LINE OA',
    settings_agents: 'ทีมงาน',
    settings_tags: 'แท็ก',
    settings_quick_replies: 'ข้อความลัด',
    online: 'Online',
    offline: 'Offline',
    logout: 'ออกจากระบบ',
    profile: 'โปรไฟล์',
    edit: 'แก้ไข',
    section_admins: 'แอดมิน',
    section_agents: 'พนักงาน',
    role: 'ยศ',
    channel_visibility: 'ช่องทางที่มองเห็นได้',
    reset_password: 'รีเซ็ตรหัสผ่าน',
    new_password: 'รหัสผ่านใหม่',
    dashboard_total_conversations: 'การสนทนาทั้งหมด',
    dashboard_open: 'กำลังเปิด',
    dashboard_closed: 'ปิดแล้ว',
    dashboard_new_conversations: 'การสนทนาใหม่',
    dashboard_messages_per_day: 'ข้อความต่อวัน',
    dashboard_by_channel: 'การสนทนาตาม OA',
    dashboard_days_7: '7 วัน',
    dashboard_days_14: '14 วัน',
    dashboard_days_30: '30 วัน',
    status_all: 'ทั้งหมด',
    status_open: 'เปิด',
    status_pending: 'รอ',
    status_closed: 'ปิด',
    search_placeholder: 'ค้นหา...',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    delete: 'ลบ',
    add: 'เพิ่ม',
  },
  en: {
    nav_group_work: 'Work',
    nav_group_manage: 'Manage',
    nav_inbox: 'Inbox',
    nav_dashboard: 'Dashboard',
    nav_report: 'Report',
    nav_settings: 'Settings',
    settings_channels: 'LINE OA Channels',
    settings_agents: 'Team',
    settings_tags: 'Tags',
    settings_quick_replies: 'Quick Replies',
    online: 'Online',
    offline: 'Offline',
    logout: 'Sign out',
    profile: 'Profile',
    edit: 'Edit',
    section_admins: 'Admins',
    section_agents: 'Agents',
    role: 'Role',
    channel_visibility: 'Visible channels',
    reset_password: 'Reset password',
    new_password: 'New password',
    dashboard_total_conversations: 'Total conversations',
    dashboard_open: 'Open',
    dashboard_closed: 'Closed',
    dashboard_new_conversations: 'New conversations',
    dashboard_messages_per_day: 'Messages per day',
    dashboard_by_channel: 'Conversations by OA',
    dashboard_days_7: '7 days',
    dashboard_days_14: '14 days',
    dashboard_days_30: '30 days',
    status_all: 'All',
    status_open: 'Open',
    status_pending: 'Pending',
    status_closed: 'Closed',
    search_placeholder: 'Search...',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    add: 'Add',
  },
};

const LanguageContext = createContext({ language: 'th', t: (k) => dict.th[k] || k });

export function LanguageProvider({ children }) {
  const { agent } = useAuth();
  const language = agent?.language === 'en' ? 'en' : 'th';

  const value = useMemo(() => ({
    language,
    t: (key) => dict[language][key] || dict.th[key] || key,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);
