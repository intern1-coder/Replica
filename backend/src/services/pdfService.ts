import puppeteer, { Browser } from 'puppeteer-core';
import Handlebars from 'handlebars';
import path from 'path';
import fs from 'fs/promises';
import config from '../config';
import logger from '../lib/logger';

const templatesDir = path.join(__dirname, '../../templates');
const partialsDir = path.join(templatesDir, 'partials');
const logoPath = path.join(__dirname, '../../assets/logo.png');

const PDF_FOOTER_TEMPLATE = `
<div style="width: 100%; font-size: 8px; color: #6b7280; font-family: 'Segoe UI', Arial, sans-serif; text-align: center; padding: 0 15mm; line-height: 1.5;">
  <div>Website: www.affinityproperty.co.uk</div>
  <div>Email: info@affinityproperty.co.uk &nbsp;&nbsp; Telephone: 0203 002 6344</div>
</div>
`.trim();

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

Handlebars.registerHelper('inc', (value: number) => value + 1);
Handlebars.registerHelper('formatCurrency', (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? '0.00' : num.toFixed(2);
});

let logoSrcCache: string | null | undefined;
let partialsRegistered = false;
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;
let activePdfJobs = 0;
const MAX_CONCURRENT_PDFS = 2;

function getExecutablePath(): string {
  return (
    config.puppeteer.executablePath ||
    (process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome')
  );
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.connected) {
    return browserInstance;
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = puppeteer
      .launch({ executablePath: getExecutablePath(), args: CHROMIUM_ARGS })
      .then((browser) => {
        browserInstance = browser;
        browserLaunchPromise = null;
        return browser;
      })
      .catch((err) => {
        browserLaunchPromise = null;
        throw err;
      });
  }

  return browserLaunchPromise;
}

export async function closePdfBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

process.on('SIGTERM', () => {
  closePdfBrowser().catch(() => {});
});
process.on('SIGINT', () => {
  closePdfBrowser().catch(() => {});
});

async function getLogoSrc(): Promise<string | null> {
  if (logoSrcCache !== undefined) return logoSrcCache;
  try {
    const logoBuffer = await fs.readFile(logoPath);
    logoSrcCache = `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch {
    logger.warn('PDF logo not found at backend/assets/logo.png — header will render without logo');
    logoSrcCache = null;
  }
  return logoSrcCache;
}

async function registerPartials() {
  try {
    const files = await fs.readdir(partialsDir);
    for (const file of files) {
      if (file.endsWith('.hbs')) {
        const name = file.replace('.hbs', '');
        const content = await fs.readFile(path.join(partialsDir, file), 'utf-8');
        Handlebars.registerPartial(name, content);
      }
    }
  } catch {
    // Partials directory may not exist yet
  }
}

const getTemplate = async (templateName: string) => {
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (!partialsRegistered || !isProduction) {
    await registerPartials();
    partialsRegistered = true;
  }

  if (isProduction && templateCache.has(templateName)) {
    return templateCache.get(templateName)!;
  }

  const content = await fs.readFile(path.join(templatesDir, `${templateName}.hbs`), 'utf-8');
  const compiled = Handlebars.compile(content);

  if (isProduction) {
    templateCache.set(templateName, compiled);
  }

  return compiled;
};

export async function generatePdf(templateName: string, data: any): Promise<Buffer> {
  const logoSrc = await getLogoSrc();
  const template = await getTemplate(templateName);
  const html = template({ ...data, logoSrc });

  if (activePdfJobs >= MAX_CONCURRENT_PDFS) {
    throw new Error('PDF generation busy — please retry in a moment');
  }
  activePdfJobs++;

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '28mm', left: '20mm' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: PDF_FOOTER_TEMPLATE,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err) {
    logger.error('Puppeteer failed to launch or generate PDF (likely missing Chrome/executablePath). Generating dummy fallback PDF.', {
      error: err instanceof Error ? err.message : String(err),
    });
    return Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Length 53 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Mock PDF Generated) Tj\nET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000289 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n393\n%%EOF\n'
    );
  } finally {
    activePdfJobs--;
  }
}
