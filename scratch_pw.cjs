const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.locator(" ").waitFor();
  } catch (e) {
    console.log(e.message);
  }
  await browser.close();
})();
