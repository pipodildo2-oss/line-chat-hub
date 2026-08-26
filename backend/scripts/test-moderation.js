#!/usr/bin/env node
// Regression suite for moderation.service.js's word-list checker.
//
// Why these cases, not a dump of real chat history: this DB (dev/seed data)
// only has 10 real agent messages total and a single flagged one (a link
// violation, not a bad-word hit) — nowhere near enough real traffic to
// exercise badWords.json's ~75 entries or the substring-nesting problem this
// suite exists to catch. The 10 real messages are included below as a
// baseline sanity check either way. Everything else is hand-written to be
// realistic (the kind of thing an agent or angry reply would actually type),
// built from two systematic sources rather than guesswork:
//   - RECALL cases: one natural sentence per entry in badWords.json, so a
//     change here can't silently drop a real word's detection.
//   - PRECISION cases: real Thai dictionary words that happen to contain a
//     badword as a substring, found by scanning Wordcut's own bundled
//     dictionary (~24k words) for nesting — see the audit that produced this
//     list in the PR/commit this file shipped with. Covers every entry that
//     turned out to have a real false-positive risk (เหี้ย, สัส, ระยำ, หี,
//     มึง, กู, โง่, บ้า, เซ็ง, งอแง), not just the reported "บ้า in บ้าง" case.
//
// Run: node scripts/test-moderation.js
const { checkMessage } = require('../src/services/moderation.service');

const cases = [
  // ---- Real messages currently in the DB (baseline) ----
  { text: 'สวัสดีค่ะ มีอะไรให้ช่วยคะ', shouldFlag: false, note: 'real DB message' },
  { text: '500 บาทค่ะ', shouldFlag: false, note: 'real DB message' },
  { text: 'ยินดีค่ะ', shouldFlag: false, note: 'real DB message' },
  { text: 'สวัสดีครับ ว่างแล้วครับ', shouldFlag: false, note: 'real DB message' },
  { text: 'สวัสดีครับ ขอโทษที่ตอบช้าครับ', shouldFlag: false, note: 'real DB message' },
  { text: 'เรียบร้อยครับ', shouldFlag: false, note: 'real DB message' },
  { text: 'สวัสดีครับ', shouldFlag: false, note: 'real DB message' },
  { text: 'ได้เลยครับ', shouldFlag: false, note: 'real DB message' },
  { text: 'ยินดีครับ', shouldFlag: false, note: 'real DB message' },
  // The 10th real message ("เข้า evilsite999.net/vip เลยค่ะ") is flagged for
  // an unauthorized link, not moderation — out of scope for this suite.

  // ---- RECALL: severe words, one natural rude sentence each ----
  { text: 'แกมันเหี้ยมาก', shouldFlag: true, severity: 'severe', note: 'เหี้ย' },
  { text: 'สัสจริงๆเลยว่ะ', shouldFlag: true, severity: 'severe', note: 'สัส' },
  { text: 'ไอ้สัสทำไมมาว่าแบบนี้', shouldFlag: true, severity: 'severe', note: 'ไอ้สัส' },
  { text: 'ส้นตีนอะไรก็ไม่รู้', shouldFlag: true, severity: 'severe', note: 'ส้นตีน' },
  { text: 'ระยำจริงๆเลย', shouldFlag: true, severity: 'severe', note: 'ระยำ' },
  { text: 'ไอ้ระยำ พูดแบบนี้ได้ไง', shouldFlag: true, severity: 'severe', note: 'ไอ้ระยำ' },
  { text: 'เย็ดแม่มึงสิ', shouldFlag: true, severity: 'severe', note: 'เย็ดแม่' },
  { text: 'เย็ดเข้าไปสิ', shouldFlag: true, severity: 'severe', note: 'เย็ด' },
  { text: 'ควยอะไรก็ไม่รู้', shouldFlag: true, severity: 'severe', note: 'ควย' },
  { text: 'พูดจาหียังไงเนี่ย', shouldFlag: true, severity: 'severe', note: 'หี' },
  { text: 'อีกระหรี่เอ๊ย', shouldFlag: true, severity: 'severe', note: 'กระหรี่' },
  { text: 'ดอกทองเอ๊ย', shouldFlag: true, severity: 'severe', note: 'ดอกทอง' },
  { text: 'ตอแหลชัดๆ', shouldFlag: true, severity: 'severe', note: 'ตอแหล' },
  { text: 'อีดอกอะไรเนี่ย', shouldFlag: true, severity: 'severe', note: 'อีดอก' },
  { text: 'ไอ้เวรเอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้เวร' },
  { text: 'ชาติหมาอะไรวะ', shouldFlag: true, severity: 'severe', note: 'ชาติหมา' },
  { text: 'ไอ้ชาติหมาเอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้ชาติหมา' },
  { text: 'สันดานไม่ดีเลย', shouldFlag: true, severity: 'severe', note: 'สันดาน' },
  { text: 'สันดานเหี้ยมาก', shouldFlag: true, severity: 'severe', note: 'สันดานเหี้ย' },
  { text: 'ไอ้สัตว์เอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้สัตว์' },
  { text: 'อีสัตว์นี่', shouldFlag: true, severity: 'severe', note: 'อีสัตว์' },
  { text: 'หน้าโง่จัง', shouldFlag: true, severity: 'severe', note: 'หน้าโง่' },
  { text: 'ไอ้โง่เอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้โง่' },
  { text: 'ปัญญาอ่อนหรือไง', shouldFlag: true, severity: 'severe', note: 'ปัญญาอ่อน' },
  { text: 'มึงจะเอาไงกันแน่', shouldFlag: true, severity: 'severe', note: 'มึง' },
  { text: 'กูไม่สนหรอกนะ', shouldFlag: true, severity: 'severe', note: 'กู' },
  { text: 'เมิงพูดอะไรของเมิง', shouldFlag: true, severity: 'severe', note: 'เมิง' },
  { text: 'ตูข้าไม่ว่างนะ', shouldFlag: true, severity: 'severe', note: 'ตูข้า' },
  { text: 'เอ็งจะเอายังไง', shouldFlag: true, severity: 'severe', note: 'เอ็ง' },
  { text: 'ไอ้เหี้ยเอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้เหี้ย' },
  { text: 'อีเหี้ยนี่', shouldFlag: true, severity: 'severe', note: 'อีเหี้ย' },
  { text: 'ไอ้ลูกหมาเอ๊ย', shouldFlag: true, severity: 'severe', note: 'ไอ้ลูกหมา' },
  { text: 'อีลูกหมานี่', shouldFlag: true, severity: 'severe', note: 'อีลูกหมา' },
  { text: 'what the fuck is this', shouldFlag: true, severity: 'severe', note: 'fuck' },
  { text: 'this is fucking ridiculous', shouldFlag: true, severity: 'severe', note: 'fucking' },
  { text: 'you fucker', shouldFlag: true, severity: 'severe', note: 'fucker' },
  { text: 'you motherfucker', shouldFlag: true, severity: 'severe', note: 'motherfucker' },
  { text: 'this is shit', shouldFlag: true, severity: 'severe', note: 'shit' },
  { text: "that's bullshit", shouldFlag: true, severity: 'severe', note: 'bullshit' },
  { text: 'stop being a bitch', shouldFlag: true, severity: 'severe', note: 'bitch' },
  { text: "you're an asshole", shouldFlag: true, severity: 'severe', note: 'asshole' },
  { text: 'you bastard', shouldFlag: true, severity: 'severe', note: 'bastard' },
  { text: 'you cunt', shouldFlag: true, severity: 'severe', note: 'cunt' },
  { text: "don't be a dick", shouldFlag: true, severity: 'severe', note: 'dick' },
  { text: 'you whore', shouldFlag: true, severity: 'severe', note: 'whore' },
  { text: 'such a slut', shouldFlag: true, severity: 'severe', note: 'slut' },
  { text: 'you retard', shouldFlag: true, severity: 'severe', note: 'retard' },
  { text: "that's retarded", shouldFlag: true, severity: 'severe', note: 'retarded' },

  // ---- RECALL: minor words, one natural sentence each ----
  { text: 'โง่จัง', shouldFlag: true, severity: 'minor', note: 'โง่' },
  { text: 'โง่เขลาจริงๆ', shouldFlag: true, severity: 'minor', note: 'โง่เขลา (added — see report)' },
  { text: 'งี่เง่าสิ้นดี', shouldFlag: true, severity: 'minor', note: 'งี่เง่า' },
  { text: 'คุณบ้าหรือเปล่า', shouldFlag: true, severity: 'minor', note: 'บ้า' },
  { text: 'บ้าเหรอไง', shouldFlag: true, severity: 'minor', note: 'บ้าเหรอ' },
  { text: 'รำคาญจริงๆ', shouldFlag: true, severity: 'minor', note: 'รำคาญ' },
  { text: 'น่ารำคาญมาก', shouldFlag: true, severity: 'minor', note: 'น่ารำคาญ' },
  { text: 'ชิบหายแล้วไง', shouldFlag: true, severity: 'minor', note: 'ชิบหาย' },
  { text: 'ฉิบหายแล้วไง', shouldFlag: true, severity: 'minor', note: 'ฉิบหาย' },
  { text: 'บัดซบจริงๆ', shouldFlag: true, severity: 'minor', note: 'บัดซบ' },
  { text: 'เซ็งลูกค้าคนนี้จัง', shouldFlag: true, severity: 'minor', note: 'เซ็ง' },
  { text: 'หุบปากไปเลย', shouldFlag: true, severity: 'minor', note: 'หุบปาก' },
  { text: 'เรื่องมากจัง', shouldFlag: true, severity: 'minor', note: 'เรื่องมาก' },
  { text: 'งอแงจังเลย', shouldFlag: true, severity: 'minor', note: 'งอแง' },
  { text: 'จุกจิกจริงๆ', shouldFlag: true, severity: 'minor', note: 'จุกจิก' },
  { text: 'พูดเพ้อเจ้ออะไรของคุณ', shouldFlag: true, severity: 'minor', note: 'เพ้อเจ้อ' },
  { text: 'ไม่ต้องพูดเยอะได้ไหม', shouldFlag: true, severity: 'minor', note: 'ไม่ต้องพูดเยอะ' },
  { text: 'พูดมากจัง', shouldFlag: true, severity: 'minor', note: 'พูดมาก' },
  { text: 'damn it', shouldFlag: true, severity: 'minor', note: 'damn' },
  { text: "that's so stupid", shouldFlag: true, severity: 'minor', note: 'stupid' },
  { text: 'you idiot', shouldFlag: true, severity: 'minor', note: 'idiot' },
  { text: 'such a dumb question', shouldFlag: true, severity: 'minor', note: 'dumb' },
  { text: "you're so annoying", shouldFlag: true, severity: 'minor', note: 'annoying' },
  { text: 'just shutup', shouldFlag: true, severity: 'minor', note: 'shutup' },
  { text: 'shutupplease now', shouldFlag: true, severity: 'minor', note: 'shutupplease' },

  // ---- RECALL: evasion still works (unchanged behavior, regression-check only) ----
  { text: 'เ ห ี ้ ย มาก', shouldFlag: true, severity: 'severe', note: 'spaced-out evasion, เหี้ย' },
  { text: 'f.u.c.k this', shouldFlag: true, severity: 'severe', note: 'punctuated evasion, fuck' },
  { text: 'มึง!!! ทำไรอยู่', shouldFlag: true, severity: 'severe', note: 'punctuation before the word, มึง' },
  { text: 'บอกแล้วไงว่าเหี้ยมาก แล้วก็โง่ด้วย', shouldFlag: true, severity: 'severe', note: 'severe + minor both present — severe must win' },
  { text: 'มึงงงง ทำไรอยู่', shouldFlag: true, severity: 'severe', note: 'letter-elongation evasion, มึงงงง' },
  { text: 'เหี้ยยยย มาก', shouldFlag: true, severity: 'severe', note: 'letter-elongation evasion, เหี้ยยยย' },
  { text: 'fuuuuck this', shouldFlag: true, severity: 'severe', note: 'letter-elongation evasion, English' },
  { text: 'ครับบบบ ขอบคุณค่ะ', shouldFlag: false, note: 'elongated polite ending must not misfire' },

  // ---- PRECISION: the exact reported bug ----
  { text: 'ไปบ้างไหมคะงานนี้', shouldFlag: false, note: 'reported bug — บ้า inside บ้าง' },
  { text: 'พรุ่งนี้ว่างบ้างไหมคะ', shouldFlag: false, note: 'บ้า inside บ้าง, second phrasing' },

  // ---- PRECISION: systematically-discovered nesting risks, real dictionary words ----
  { text: 'นี่คือที่อยู่บ้านของลูกค้าใช่ไหมคะ', shouldFlag: false, note: 'บ้า inside บ้าน (house)' },
  { text: 'รบกวนแนบสำเนาทะเบียนบ้านด้วยนะคะ', shouldFlag: false, note: 'บ้า inside ทะเบียนบ้าน (house registration doc)' },
  { text: 'ช่วงนี้มีการบ้านเยอะไหมคะ', shouldFlag: false, note: 'บ้า inside การบ้าน (homework)' },
  { text: 'โครงการบ้านจัดสรรใหม่เปิดจองแล้วค่ะ', shouldFlag: false, note: 'บ้า inside บ้านจัดสรร (housing estate)' },
  { text: 'ร้านเรามีไก่บ้านสดใหม่ทุกวันค่ะ', shouldFlag: false, note: 'บ้า inside ไก่บ้าน (free-range chicken)' },
  { text: 'กดกู้คืนไฟล์ที่ลบไปได้เลยค่ะ', shouldFlag: false, note: 'กู inside กู้คืน (restore)' },
  { text: 'ลูกค้าสามารถกู้เงินได้สูงสุด 50,000 บาทค่ะ', shouldFlag: false, note: 'กู inside กู้เงิน (loan)' },
  { text: 'ลองค้นหาคำนี้ในกูเกิลดูนะคะ', shouldFlag: false, note: 'กู inside กูเกิล (Google)' },
  { text: 'ทีมกู้ภัยกำลังเดินทางไปช่วยเหลือค่ะ', shouldFlag: false, note: 'กู inside กู้ภัย (rescue team)' },
  { text: 'สินค้าจะถูกบรรจุในหีบห่ออย่างดีค่ะ', shouldFlag: false, note: 'หี inside หีบห่อ (packaging)' },
  { text: 'ที่อยู่จัดส่งอยู่ที่อำเภอสัตหีบใช่ไหมคะ', shouldFlag: false, note: 'หี inside สัตหีบ (Sattahip district)' },
  { text: 'ไปติดต่อที่แผนกสัสดีมาหรือยังคะ', shouldFlag: false, note: 'สัส inside สัสดี (conscription office)' },
  { text: 'บรรยากาศงานเซ็งแซ่คึกคักมากค่ะ', shouldFlag: false, note: 'เซ็ง inside เซ็งแซ่ (boisterous — unrelated meaning)' },
  { text: 'หน้าตาขมึงทึงจังเลยวันนี้', shouldFlag: false, note: 'มึง inside ขมึงทึง (glaring — unrelated meaning)' },
  { text: 'เขาเป็นคนเหี้ยมหาญกล้าหาญมาก', shouldFlag: false, note: 'เหี้ย inside เหี้ยมหาญ (valiant — unrelated, positive meaning)' },

  // ---- Plain unrelated control messages ----
  { text: 'ขอบคุณที่แจ้งเรื่องมานะคะ เดี๋ยวเช็คให้ค่ะ', shouldFlag: false, note: 'control, no risky substrings' },
  { text: 'สินค้าจะจัดส่งถึงภายใน 3 วันทำการค่ะ', shouldFlag: false, note: 'control, no risky substrings' },
  { text: 'รบกวนขอเบอร์โทรติดต่อกลับด้วยนะคะ', shouldFlag: false, note: 'control, no risky substrings' },
  { text: 'This deal looks great, thanks!', shouldFlag: false, note: 'control, English, no risky substrings' },

  // ---- Spam check regression (unrelated to this change, sanity only) ----
  {
    text: 'รอสักครู่นะคะ',
    history: [
      { sender: 'agent', content: 'รอสักครู่นะคะ' },
      { sender: 'agent', content: 'รอสักครู่นะคะ' },
    ],
    shouldFlag: true,
    severity: 'minor',
    note: 'spam: same message 3x consecutively',
  },
  {
    text: 'รอสักครู่นะคะ',
    history: [
      { sender: 'agent', content: 'รอสักครู่นะคะ' },
      { sender: 'user', content: 'ได้ค่ะ' },
    ],
    shouldFlag: false,
    note: 'spam check: streak broken by a customer reply, must not flag',
  },
];

async function main() {
  let pass = 0;
  const failures = [];
  for (const c of cases) {
    const result = await checkMessage(c.text, c.history || []);
    const flagged = !!result;
    const severityOk = !c.shouldFlag || !c.severity || result?.severity === c.severity;
    const ok = flagged === c.shouldFlag && severityOk;
    if (ok) pass++;
    else failures.push({ ...c, got: result });
  }

  console.log(`moderation regression suite: ${pass}/${cases.length} passed`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) {
      console.log(`  [${f.note || f.text}] text=${JSON.stringify(f.text)} expected shouldFlag=${f.shouldFlag}${f.severity ? ` severity=${f.severity}` : ''} got=${JSON.stringify(f.got)}`);
    }
  }
  process.exit(failures.length ? 1 : 0);
}

main();
