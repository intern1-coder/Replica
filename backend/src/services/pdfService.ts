import puppeteer from 'puppeteer-core';
import Handlebars from 'handlebars';
import path from 'path';
import fs from 'fs/promises';
import config from '../config';

// Pre-compile handlebars templates
const templatesDir = path.join(__dirname, '../../templates');

const getTemplate = async (templateName: string) => {
  const content = await fs.readFile(path.join(templatesDir, `${templateName}.hbs`), 'utf-8');
  return Handlebars.compile(content);
};

export async function generatePdf(templateName: string, data: any): Promise<Buffer> {
  const template = await getTemplate(templateName);
  const html = template(data);

  // Fallback to standard Chrome path if executablePath is missing (useful for local testing)
  // For production ARM64 VM, PUPPETEER_EXECUTABLE_PATH MUST be set (e.g. /usr/bin/chromium)
  const executablePath = config.puppeteer.executablePath ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

  const browser = await puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
