import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chromium } from 'playwright';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = join(repositoryRoot, 'test-results');
const testMnemonic = 'test test test test test test test test test test test junk';

async function getExtensionId(context) {
  const existingWorker = context.serviceWorkers()[0];
  const worker = existingWorker || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  assert.match(extensionId, /^[a-z]{32}$/, 'extension service worker should expose a valid id');
  return extensionId;
}

async function terminateExtensionServiceWorker(context, page, extensionId) {
  const cdp = await context.newCDPSession(page);
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(info =>
      info.type === 'service_worker' && info.url.startsWith(`chrome-extension://${extensionId}/`)
    );
    assert.ok(target?.targetId, 'extension service worker target should exist before termination');
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
  } finally {
    await cdp.detach();
  }
}

test('loads the MV3 extension and preserves wallet state across lock and unlock', { timeout: 90_000, concurrency: false }, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'yeying-wallet-e2e-'));
  let context;
  let page;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${repositoryRoot}`,
        `--load-extension=${repositoryRoot}`
      ]
    });

    const extensionId = await getExtensionId(context);
    const popupUrl = `chrome-extension://${extensionId}/html/popup.html`;

    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);

    await page.locator('#welcomePage').waitFor({ state: 'visible' });
    assert.equal(await page.title(), '夜莺钱包');
    assert.equal((await page.locator('#welcomeCreateWalletBtn').textContent())?.trim(), '新建钱包');

    await page.locator('#welcomeCreateWalletBtn').click();
    await page.locator('#setPasswordPage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#setWalletName').inputValue(), '主钱包');
    assert.equal((await page.locator('#setPasswordBtn').textContent())?.trim(), '创建钱包');

    await page.locator('#setWalletName').fill('E2E Wallet');
    await page.locator('#newPassword').fill('E2E-password-2026');
    await page.locator('#confirmPassword').fill('E2E-password-2026');
    await page.locator('#setPasswordBtn').click();

    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2_500);
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'extension-wallet-created.png'), fullPage: true });

    await page.close();
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);
    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal(await page.locator('#welcomePage').isVisible(), false);

    const accountBeforeLock = (await page.locator('#accountAddress').textContent())?.trim();
    assert.match(accountBeforeLock || '', /^0x[\da-fA-F]+(?:…|\.\.\.)[\da-fA-F]+$/);

    const headerMenuButton = page.locator('#walletHeaderMenuBtn');
    await headerMenuButton.waitFor({ state: 'visible' });
    await headerMenuButton.click();
    const headerMenu = page.locator('#walletHeaderMenu');
    try {
      await headerMenu.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      await headerMenuButton.click();
      await headerMenu.waitFor({ state: 'visible', timeout: 5_000 });
    }
    assert.equal(await headerMenuButton.getAttribute('aria-expanded'), 'true');
    await page.locator('#lockWalletBtn').click();
    await page.locator('#unlockPage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#walletPage').isVisible(), false);

    await page.close();
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);
    await page.locator('#unlockPage').waitFor({ state: 'visible', timeout: 30_000 });

    await page.locator('#unlockPassword').fill('incorrect-password');
    await page.locator('#unlockBtn').click();
    await page.locator('#globalToast').filter({ hasText: '密码错误' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#unlockPage').isVisible(), true);
    assert.equal(await page.locator('#globalWaitingOverlay').isVisible(), false);

    await context.route('https://blockchain.yeying.pub/**', route => route.abort('connectionfailed'));
    await page.locator('#unlockPassword').fill('E2E-password-2026');
    await page.locator('#unlockBtn').click();
    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator('#globalWaitingOverlay').isVisible(), false);
    assert.equal((await page.locator('#accountAddress').textContent())?.trim(), accountBeforeLock);
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: join(screenshotDir, 'extension-wallet-unlocked.png'), fullPage: true });

    await page.locator('#transferBtn').click();
    await page.locator('#transferPage').waitFor({ state: 'visible' });
    await page.locator('#recipientAddress').fill('0x1111111111111111111111111111111111111111');
    await page.locator('#amount').fill('1.25');
    await page.close();
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);
    await page.locator('#transferPage').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator('#recipientAddress').inputValue(), '0x1111111111111111111111111111111111111111');
    assert.equal(await page.locator('#amount').inputValue(), '1.25');
    assert.equal(await page.locator('#unlockPassword').inputValue(), '');
    await page.locator('#transferPage .back-btn').click();
    await page.locator('#walletPage').waitFor({ state: 'visible' });

    await terminateExtensionServiceWorker(context, page, extensionId);
    await page.close();
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);
    await page.locator('#unlockPage').waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal(await page.locator('#welcomePage').isVisible(), false);
    await page.locator('#unlockPassword').fill('E2E-password-2026');
    await page.locator('#unlockBtn').click();
    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal((await page.locator('#accountAddress').textContent())?.trim(), accountBeforeLock);
    assert.equal(await page.locator('#globalWaitingOverlay').isVisible(), false);
  } catch (error) {
    if (page && !page.isClosed()) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'extension-smoke-failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test('imports a mnemonic wallet and persists the derived account', { timeout: 90_000, concurrency: false }, async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'yeying-wallet-e2e-'));
  let context;
  let page;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${repositoryRoot}`,
        `--load-extension=${repositoryRoot}`
      ]
    });

    const extensionId = await getExtensionId(context);
    const popupUrl = `chrome-extension://${extensionId}/html/popup.html`;
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);

    await page.locator('#welcomePage').waitFor({ state: 'visible' });
    await page.locator('#welcomeImportWalletBtn').click();
    await page.locator('#importPage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.import-tab.active').getAttribute('data-type'), 'mnemonic');

    await page.locator('#importAccountName').fill('Imported E2E Wallet');
    await page.locator('#importMnemonic').fill(testMnemonic);
    await page.locator('#importWalletPassword').fill('E2E-password-2026');
    await page.locator('#importBtn').click();

    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2_500);
    const importedAddress = (await page.locator('#accountAddress').textContent())?.trim();
    assert.equal(importedAddress, '0xf39...92266');
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'extension-wallet-imported.png'), fullPage: true });

    await page.close();
    page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.goto(popupUrl);
    await page.locator('#walletPage').waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal((await page.locator('#accountAddress').textContent())?.trim(), importedAddress);
  } catch (error) {
    if (page && !page.isClosed()) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: join(screenshotDir, 'extension-import-failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
