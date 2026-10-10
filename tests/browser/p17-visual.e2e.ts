import { expect, test } from '@playwright/test';

const url='/tests/browser/p17-visual.html';

test('real cookbook card: editorial grid/list, focus-managed recipe detail and visual evidence',async({page},testInfo)=>{
  await page.goto(url);
  await expect(page.getByRole('heading',{name:'My cookbook'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Grid view'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'List view'}).click();
  const list=page.locator('.recipe-grid');
  await expect(list).toHaveAttribute('data-view','list');
  await expect(page.getByRole('button',{name:'List view'})).toHaveAttribute('aria-pressed','true');
  const columns=await page.locator('.recipe-card').evaluate(node=>getComputedStyle(node).gridTemplateColumns);
  expect(columns.split(' ').length).toBeGreaterThanOrEqual(2);
  await page.screenshot({path:'test-results/p17-'+testInfo.project.name+'-list.png',fullPage:true});
  await page.getByRole('button',{name:'Open Weeknight Pasta'}).click();
  const dialog=page.getByRole('dialog',{name:'Weeknight Pasta'});
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button',{name:'Close recipe details'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
  await page.getByRole('button',{name:/Method 2/}).click();
  await expect(page.locator('#recipe-detail-method')).toBeFocused();
  await page.screenshot({path:'test-results/p17-'+testInfo.project.name+'-detail.png',fullPage:true});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open Weeknight Pasta'})).toBeFocused();
  const dimensions=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    document:document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport+1);
});

test('editor outline, weekly shopping focus and cooking focus mode preserve core functionality',async({page})=>{
  await page.goto(url);
  await page.getByRole('navigation',{name:'Synthetic test surfaces'}).getByRole('button',{name:'studio'}).click();
  await expect(page.getByRole('navigation',{name:'Jump to editor section'})).toBeVisible();
  await page.getByRole('link',{name:/Ingredients 1/}).click();
  await expect(page.locator('#studio-section-ingredients')).toBeVisible();
  await page.getByRole('navigation',{name:'Synthetic test surfaces'}).getByRole('button',{name:'cook'}).click();
  await expect(page.getByRole('heading',{name:'Hands-free cooking'})).toBeVisible();
  await page.getByRole('button',{name:'Focus on steps'}).click();
  await expect(page.getByRole('button',{name:'Show ingredients'})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#kitchen-ingredients-panel')).toBeHidden();
  await expect(page.getByRole('heading',{name:'Kitchen timers'})).toBeVisible();
  await page.getByRole('button',{name:'Add timer'}).click();
  await expect(page.getByText('1/8')).toBeVisible();
  await page.getByRole('button',{name:'Show ingredients'}).click();
  await expect(page.locator('#kitchen-ingredients-panel')).toBeVisible();
  await page.getByRole('navigation',{name:'Synthetic test surfaces'}).getByRole('button',{name:'plan'}).click();
  await expect(page.getByText(/of 28 meal slots planned/)).toBeVisible();
  await page.getByRole('button',{name:/Shopping list/}).click();
  await expect(page.getByRole('complementary',{name:'Shopping list'})).toBeFocused();
});

test('reduced motion and 200% CSS zoom preserve usable control reflow',async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(url);
  await page.getByRole('button',{name:'List view'}).click();
  const duration=await page.locator('.recipe-card').evaluate(el=>getComputedStyle(el).transitionDuration);
  expect(duration.split(',').map(v=>v.trim())).toEqual(['0s']);
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  const dimensions=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport+1);
  await expect(page.getByRole('button',{name:'Open Weeknight Pasta'})).toBeVisible();
  await page.screenshot({path:'test-results/p17-'+testInfo.project.name+'-zoom200.png',fullPage:true});
});
