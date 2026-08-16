// شغّل هذا الملف مرة واحدة فقط عند أول إعداد للسيرفر:
//   node generate-vapid.js
// ثم انسخ القيمتين الناتجتين إلى ملف .env

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\nأضف هذين السطرين إلى ملف .env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nوانسخ VAPID_PUBLIC_KEY أيضًا إلى PUSH_CONFIG.vapidPublicKey داخل app.js\n');
