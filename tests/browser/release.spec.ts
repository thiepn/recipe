import { test, expect } from '@playwright/test';

test('signed-out page loads without losing the private-account boundary', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {
    name: /Every recipe worth keeping/i,
  })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Google/i }))
    .toBeVisible();
  await expect(page.getByText('Recipes are private by default.'))
    .toBeVisible();
  expect(errors).toEqual([]);
});

for (const path of ['/recipes', '/collections', '/cook', '/plan']) {
  test(`route ${path} preserves auth gate and does not overflow`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('button', { name: /Continue with Google/i }))
      .toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

test('invalid OAuth callback shows recoverable error rather than blank UI', async ({ page }) => {
  await page.goto('/auth/callback');
  await expect(page.getByRole('heading', { name: /Could not open Recipe/i }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: /Retry opening Recipe/i }))
    .toBeVisible();
});
