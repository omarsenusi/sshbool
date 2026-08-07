# SSHBool 🚀

<p align="center">
  <strong>بيئة عمل متكاملة وفائقة السرعة لإدارة البنية التحتية والخوادم عن بُعد</strong><br />
  <em>A Native, Blazing-Fast Desktop Workspace for Remote Infrastructure Management</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-Core-black?logo=rust" alt="Rust Core" />
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-Fast-646CFF?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/Security-AES--256-green" alt="AES-256 Encrypted" />
</p>

---

## 📌 نبذة عن المشروع (About SSHBool)

**SSHBool** هو تطبيق مكتبي متكامل (Native Desktop Application) مصمم خصيصاً للمطورين، مهندسي العمليات (DevOps)، ومديري الأنظمة (Sysadmins). بدلاً من تشتيت العمل بين برامج الطرفية (Terminal)، ونقل الملفات (SFTP)، ومتصفحات قواعد البيانات، ووسائل مراقبة الخوادم؛ يجمع **SSHBool** كل هذه الأدوات في مساحة عمل واحدة متميزة وجميلة وسريعة.

يعتمد المشروع على مبدأ **"اتصل مرة واحدة، وافعل كل شيء" (Connect once, do everything)**؛ حيث يتم استخدام اتصال SSH نشط واحد وتمرير كافة العمليات (الطرفية، تصفح الملفات، مراقبة الموارد، استعلامات البيانات) من خلاله عبر قنوات متعددة (Multiplexed Channels) لتوفير أقصى سرعة وأقل استهلاك لموارد الخادم والجهاز المحلي.

---

## 🖼️ لقطات شاشة من التطبيق (Screenshots)

<div align="center">
  <table style="width:100%; border:none;">
    <tr>
      <td width="50%" align="center">
        <strong>شاشة لوحة التحكم الرئيسية / إدارة الاتصالات</strong><br />
        <img src="screenshots/1.png" alt="Dashboard & Connection Manager" width="100%" />
      </td>
      <td width="50%" align="center">
        <strong>إدارة وإعدادات الخوادم والاتصالات</strong><br />
        <img src="screenshots/2.png" alt="Server Settings" width="100%" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>الطرفية المتكاملة والـ SFTP ونظام الحماية (Vault)</strong><br />
        <img src="screenshots/3.png" alt="Terminal & SFTP Workspace" width="100%" />
      </td>
      <td width="50%" align="center">
        <strong>إدارة التراخيص والأجهزة المتصلة</strong><br />
        <img src="screenshots/4.png" alt="Licenses & Devices Panel" width="100%" />
      </td>
    </tr>
  </table>
</div>

---

## ✨ المميزات الرئيسية (Key Features)

*   ⚡ **أداء أصلي فائق السرعة (Native Performance):** مبني بالكامل باستخدام لغة **Rust** وإطار العمل **Tauri v2** لتفادي استهلاك الذاكرة الضخم لبيئات Electron. التطبيق يبدأ في أقل من 800 مللي ثانية.
*   🔒 **أمان متكامل بشكل افتراضي (Security by Default):**
    *   تشفير كامل لكافة البيانات وكلمات المرور محلياً باستخدام خوارزمية **AES-256** عبر **SQLCipher**.
    *   توليد مفاتيح التشفير وتأمينها باستخدام **Argon2id** بناءً على كلمة المرور الرئيسية (Master Password).
    *   دعم مفاتيح الأمان الفيزيائية مثل **FIDO2 / YubiKey**.
*   🌐 **اتصال أحادي متعدد القنوات (Multiplexed Transport):** فتح اتصال SSH واحد بالخادم واستغلاله لتشغيل الطرفية، وتعديل الملفات، واستعراض قواعد البيانات دون الحاجة لإنشاء اتصالات مستقلة متكررة.
*   🖥️ **طرفية متطورة (High-Performance Terminal):** محاكي طرفية كامل مدمج مبني على **Xterm.js** مع دعم تسريع الرسوميات عبر WebGL للحصول على سرعة فائقة في معالجة المخرجات.
*   📂 **إدارة ملفات متكاملة (Dual-Pane SFTP):** متصفح ملفات ثنائي النوافذ يدعم عمليات السحب والإفلات، وإدارة الملفات البعيدة، والتنقل السلس.
*   📝 **محرر نصوص بعيد (Remote Code Editor):** تعديل ملفات الإعدادات والبرمجة مباشرة على الخادم باستخدام محرر **Monaco** المدمج مع دعم كامل لتلوين الأكواد البرمجية (Syntax Highlighting).
*   📊 **مراقبة حية للموارد (Server Metrics & Monitoring):** قراءة حية ومباشرة لموارد المعالج (CPU)، والذاكرة (RAM)، ومساحة التخزين، واستهلاك الشبكة للخادم المتصل.
*   🗄️ **مستكشف قواعد البيانات (Database Explorer):** فحص تلقائي لقواعد البيانات النشطة على الخادم (مثل PostgreSQL، MySQL، Redis، MongoDB) والاتصال بها لتشغيل الاستعلامات واستعراض الجداول بسهولة.

---

## 🛠️ البنية البرمجية والتقنيات المستخدمة (Tech Stack)

*   **النواة والتحكم (Backend Core):** Rust & Tauri v2
*   **الواجهة الرسومية (Frontend):** React 19 + TypeScript + Vite
*   **تنسيق الواجهة (Styling):** TailwindCSS v4 + Base UI
*   **إدارة الحالة (State Management):** Zustand + TanStack Query v5
*   **قاعدة البيانات المحلية (Local Database):** SQLite (المشفرة عبر SQLCipher)
*   **محاكي الطرفية (Terminal):** Xterm.js
*   **محرر النصوص (Editor):** Monaco Editor

---

## 🚀 طريقة البدء والتشغيل (Getting Started)

### متطلبات التشغيل (Prerequisites)
تأكد من تثبيت الأدوات التالية على جهازك:
*   [Node.js](https://nodejs.org/) (يُفضل استخدام أحدث إصدار LTS)
*   [Rust](https://www.rust-lang.org/) (عن طريق rustup لتشغيل Tauri)
*   [Bun](https://bun.sh/) (كمدير الحزم الافتراضي لتسريع التشغيل)

### خطوات التشغيل بيئة التطوير (Development Setup)

1. **تثبيت الاعتماديات والمكتبات:**
   ```bash
   bun install
   ```

2. **تشغيل التطبيق في وضع التطوير (Tauri dev mode):**
   ```bash
   bun run tauri dev
   ```

3. **فحص الجودة وأنواع البيانات (Quality Checks):**
   ```bash
   # فحص أنواع TypeScript
   bun run typecheck

   # فحص الأكواد وتنسيقها
   bun run lint

   # تشغيل اختبارات الواجهة
   bun run test

   # تشغيل اختبارات لغة Rust (الخلفية)
   cargo test --manifest-path src-tauri/Cargo.toml --workspace --lib
   ```

---

## 📂 تفاصيل إضافية (Documentation)

لمزيد من التفاصيل حول هيكلية المشروع، وتصميم قاعدة البيانات، والخطط المستقبلية، يرجى مراجعة المجلد الخاص بالتوثيق:
*   **مخطط المشروع واستراتيجية العمل:** [`docs/README.md`](docs/README.md)
