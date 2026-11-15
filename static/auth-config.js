/* ตั้งค่าการเข้าสู่ระบบ Microsoft 365 ของ PSG Executive Dashboard (เว็บ static บน GitHub Pages)
   ไม่มีความลับในไฟล์นี้ (client/tenant/group ID เปิดเผยได้) — คัดลอกเป็น static/auth-config.js แล้วใส่ค่าจริง */
window.DASH_AUTH = {
  clientId: '75b5084b-4823-4a13-bb79-d47af910fb21',   // App registration เดิม "CCC Staff Status Login" (ใช้ร่วมกับ STG/HEA/SAM)
  tenantId: '54cf0b45-7b5b-41b0-bbeb-dddef5eae512',
  groupId: '71b6df9d-1659-4f18-bd7d-79f80d6add6b',
  groupName: 'psg_dashboard_viewers',
  keyShareUrl: 'https://sevenutilitiesandpower.sharepoint.com/:t:/g/IQAHoboeHoqlS7GrqJSRbMa5Ac_1JUaoQdOdJ71HyVw-H-w?e=ueAsUe',
  // redirectUri: 'https://energyforsociety.github.io/PSG-Executive-Dashboard/',   // ไม่ใส่ = ใช้ URL ของหน้าเว็บเอง
};
