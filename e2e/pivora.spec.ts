import { expect, test, type Page } from '@playwright/test';

function capturePageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openBlankWorkspace(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('pivora-ui-locale', 'en');
  });
  await page.goto('/');
  const blankTemplate = page.locator('.template-card').filter({
    hasText: 'Blank canvas',
  });
  await expect(blankTemplate).toBeVisible();
  await blankTemplate.click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('switches the primary workspace language and remembers the choice', async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await page.goto('/');

  const language = page.getByLabel('Interface language');
  await expect(language).toHaveValue('en');
  await language.selectOption('zh-CN');

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(
    page.getByRole('heading', { name: '从成熟的结构开始' }),
  ).toBeVisible();
  await expect(
    page.locator('.template-card').filter({ hasText: '零售绩效' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '报表', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Pivora — 本地优先分析工作室');

  await page.locator('.template-card').filter({ hasText: '零售绩效' }).click();
  await page.getByRole('button', { name: '数据与清洗' }).click();
  await expect(page.getByText('数据准备', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '模型', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '表、关系与公式' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'SQL 工作台' }).click();
  await expect(page.getByRole('heading', { name: 'SQL 工作台' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('界面语言')).toHaveValue('zh-CN');
  await expect(
    page.getByRole('button', { name: '模型', exact: true }),
  ).toBeVisible();

  await page.getByLabel('界面语言').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('button', { name: 'Model', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Pivora — Local-first analytics studio');
  await page.reload();
  await expect(page.getByLabel('Interface language')).toHaveValue('en');
  expect(pageErrors).toEqual([]);
});

test('imports tables, switches data, authors a freeform visual, and exports a report', async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  const loadedChunks: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/_next/static/chunks/')) loadedChunks.push(url);
  });
  await openBlankWorkspace(page);
  expect(
    loadedChunks.some((url) =>
      /chart-visual|data-import|xlsx|jspdf|duckdb-engine/u.test(url),
    ),
  ).toBe(false);

  const dataInput = page.locator('input[type="file"][accept*=".csv"]');
  await dataInput.setInputFiles([
    {
      name: 'orders.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'region,revenue,cost\nNorth,120,70\nSouth,90,50\nWest,140,80\n',
      ),
    },
    {
      name: 'inventory.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('product,stock\nAlpha,14\nBeta,8\n'),
    },
  ]);

  await expect(page.locator('.notice')).toContainText(
    'Imported 2 table(s), 5 rows.',
  );
  await expect
    .poll(() => loadedChunks.some((url) => url.includes('data-import')))
    .toBe(true);
  await page.getByRole('button', { name: 'Data & clean' }).click();
  const tablePicker = page.getByLabel('Active data table');
  await tablePicker.selectOption({ label: 'inventory' });
  await expect(page.getByRole('heading', { name: 'inventory' })).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);

  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.react-grid-item')).toHaveCount(2);
  expect(loadedChunks.some((url) => url.includes('chart-visual'))).toBe(true);
  await page.getByRole('button', { name: 'Freeform' }).click();

  const visual = page.locator('.react-grid-item').nth(1);
  const dragHandle = visual.locator('.drag-handle');
  const beforeDrag = await visual.boundingBox();
  const handleBox = await dragHandle.boundingBox();
  expect(beforeDrag).not.toBeNull();
  expect(handleBox).not.toBeNull();
  if (!beforeDrag || !handleBox)
    throw new Error('Visual geometry unavailable.');

  const dragStartX = handleBox.x + handleBox.width / 2;
  const dragStartY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 220, dragStartY + 90, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await visual.boundingBox();
  expect(afterDrag).not.toBeNull();
  expect(afterDrag?.x ?? 0).toBeGreaterThan(beforeDrag.x + 80);

  await visual.scrollIntoViewIfNeeded();
  const resizeHandle = visual.locator('.react-resizable-handle').last();
  const resizeBox = await resizeHandle.boundingBox();
  const beforeResize = await visual.boundingBox();
  expect(resizeBox).not.toBeNull();
  expect(beforeResize).not.toBeNull();
  if (!resizeBox || !beforeResize)
    throw new Error('Visual resize geometry unavailable.');
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 120, resizeBox.y + 70, { steps: 8 });
  await page.mouse.up();
  const afterResize = await visual.boundingBox();
  expect(afterResize).not.toBeNull();
  expect(afterResize?.width ?? 0).toBeGreaterThan(beforeResize.width + 40);

  const bundleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report bundle' }).click();
  expect((await bundleDownload).suggestedFilename()).toBe(
    'untitled-report.pivora',
  );

  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  expect((await pngDownload).suggestedFilename()).toBe('Untitled report.png');
  expect(
    loadedChunks.some((url) => /xlsx|jspdf|duckdb-engine/u.test(url)),
  ).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('imports a data lake manifest and a desktop ODBC query', async ({
  page,
}) => {
  const pageErrors = capturePageErrors(page);
  await page.addInitScript(() => {
    window.pivoraDesktop = {
      platform: 'win32',
      listOdbcSources: async () => ({
        available: true,
        drivers: [{ name: 'Warehouse Driver', platform: '64-bit' }],
        sources: [
          {
            name: 'Warehouse DSN',
            driver: 'Warehouse Driver',
            type: 'User',
            platform: '64-bit',
          },
        ],
      }),
      runOdbcQuery: async (request) => {
        if (request.connectionString !== 'DSN={Warehouse DSN};') {
          throw new Error('Unexpected ODBC connection string.');
        }
        if (!request.query.startsWith('SELECT')) {
          throw new Error('Unexpected ODBC query.');
        }
        return {
          columns: ['region', 'revenue'],
          rows: [
            { region: 'North', revenue: 220 },
            { region: 'South', revenue: 180 },
          ],
          truncated: false,
          durationMs: 12.5,
          driver: 'Warehouse Driver',
          dataSource: 'Warehouse DSN',
          database: 'Analytics',
        };
      },
      retryRuntime: async () => ({ ok: true }),
      runtimeStatus: async () => ({
        message: 'Ready',
        logPath: '',
        running: true,
      }),
    };
  });
  await page.route('https://lake.example.test/manifest.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        objects: [
          {
            url: 'https://lake.example.test/curated/facts.csv?temporary=session',
          },
        ],
      }),
    });
  });
  await page.route(
    'https://lake.example.test/curated/facts.csv?temporary=session',
    async (route) => {
      await route.fulfill({
        contentType: 'text/csv',
        body: 'region,revenue\nEast,90\nWest,110\n',
      });
    },
  );
  await openBlankWorkspace(page);

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const connectors = page.getByRole('dialog', { name: 'Data connectors' });
  await expect(connectors).toBeVisible();
  await connectors.getByRole('button', { name: 'Data lake' }).click();
  await page.getByLabel('Data lake provider').selectOption('manifest');
  await page
    .getByLabel('Data lake endpoint')
    .fill('https://lake.example.test/manifest.json');
  await page.getByRole('button', { name: 'Discover objects' }).click();
  await expect(page.getByText('curated/facts.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Import selected (1)' }).click();
  await expect(page.locator('.notice')).toContainText(
    'Imported 1 data lake table(s), 2 rows.',
  );

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Data connectors' })
    .getByRole('button', { name: 'ODBC', exact: true })
    .click();
  await expect(page.getByLabel('ODBC data source')).toHaveValue(
    'Warehouse DSN',
  );
  await page.getByLabel('ODBC imported table name').fill('Warehouse live');
  await page
    .getByLabel('ODBC SQL query')
    .fill('SELECT region, revenue FROM warehouse_facts');
  await page.getByRole('button', { name: 'Run & import' }).click();
  await expect(page.locator('.notice')).toContainText(
    'Imported ODBC table with 2 rows',
  );

  await page.getByRole('button', { name: 'Data & clean' }).click();
  await expect(
    page.getByRole('heading', { name: 'Warehouse live' }),
  ).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});
