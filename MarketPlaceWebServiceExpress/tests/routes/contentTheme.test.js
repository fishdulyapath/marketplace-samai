const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');

const CONTENT_ROUTE_PATH = require.resolve('../../src/routes/content');

function loadContentApp({ contentDir, dbName }) {
  process.env.MARKETPLACE_CONTENT_DIR = contentDir;
  process.env.MARKETPLACE_CONTENT_SCOPE = 'database';
  process.env.DB_NAME = dbName;
  jest.resetModules();
  delete require.cache[CONTENT_ROUTE_PATH];

  const app = express();
  app.use(express.json());
  app.use('/service/v1', require('../../src/routes/content'));
  return app;
}

describe('content theme presets', () => {
  const originalEnv = {
    MARKETPLACE_CONTENT_DIR: process.env.MARKETPLACE_CONTENT_DIR,
    MARKETPLACE_CONTENT_SCOPE: process.env.MARKETPLACE_CONTENT_SCOPE,
    DB_NAME: process.env.DB_NAME,
  };
  let contentDir;

  beforeEach(async () => {
    contentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marketplace-content-theme-'));
  });

  afterEach(async () => {
    delete require.cache[CONTENT_ROUTE_PATH];
    await fs.rm(contentDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('ใช้ Clean Green + White เป็นค่าเริ่มต้นเมื่อฐานยังไม่มีไฟล์ content', async () => {
    const response = await request(loadContentApp({ contentDir, dbName: 'fresh_shop' }))
      .get('/service/v1/content/home')
      .expect(200);

    expect(response.body.data.theme).toMatchObject({
      preset: 'cleanGreen',
      basePreset: 'cleanGreen',
      primaryColor: '#0f9f6e',
      headerBackground: '#ffffff',
      headerTextColor: '#064e3b',
      backgroundColor: '#f7f9f8',
      productCardBorder: '#dde8e3',
    });
  });

  it('ยังอ่าน Shop Green เดิมได้โดยไม่เปลี่ยนเป็น preset ใหม่', async () => {
    const dbName = 'legacy_shop';
    await fs.writeFile(
      path.join(contentDir, `marketplace-content.${dbName}.json`),
      JSON.stringify({
        theme: {
          preset: 'shopGreen',
          basePreset: 'shopGreen',
          primaryColor: '#0F9F6E',
          accentColor: '#F97316',
          headerBackground: '#0A7D56',
          headerTextColor: '#FFFFFF',
          backgroundColor: '#F4F6F8',
          productCardBackground: '#FFFFFF',
          productImageBackground: '#FFFFFF',
          productCardBorder: '#E6EBEF',
          footerBackground: '#FFFFFF',
          footerTextColor: '#1F2937',
        },
      }),
      'utf8'
    );

    const response = await request(loadContentApp({ contentDir, dbName }))
      .get('/service/v1/content/home')
      .expect(200);

    expect(response.body.data.theme).toMatchObject({
      preset: 'shopGreen',
      basePreset: 'shopGreen',
      headerBackground: '#0A7D56',
      headerTextColor: '#FFFFFF',
    });
  });
});
