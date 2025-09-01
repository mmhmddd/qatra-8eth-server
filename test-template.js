import fsPromises from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testTemplate() {
  try {
    const templatePath = path.join(__dirname, 'reset-password-email.html');
    console.log('مسار ملف القالب:', templatePath);
    console.log('هل ملف القالب موجود؟', existsSync(templatePath));
    const source = await fsPromises.readFile(templatePath, 'utf8');
    console.log('تم قراءة ملف القالب بنجاح:', source.slice(0, 100));
    const template = handlebars.compile(source);
    const htmlContent = template({ name: 'تجربة', resetUrl: 'https://example.com/reset' });
    console.log('تم إنشاء محتوى HTML:', htmlContent.slice(0, 100));
  } catch (error) {
    console.error('خطأ في اختبار القالب:', error.message, error.stack);
  }
}

testTemplate();