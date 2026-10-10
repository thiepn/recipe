import {expect,test} from '@playwright/test';
const route='/tests/browser/p20-accessibility.html';
test('Add Recipe and Import modal keyboard loop and safe focus restoration',async({page})=>{
 await page.goto(route);
 const nav=page.getByRole('navigation',{name:'Synthetic accessibility surfaces'});
 await nav.getByRole('button',{name:'add'}).click();
 let dialog=page.getByRole('dialog',{name:'Add a recipe'});
 await expect(dialog).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Recipe title'})).toBeFocused();
 await dialog.getByRole('button',{name:/Blank recipe/}).click();
 await expect(page.getByRole('textbox',{name:'Recipe title'})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(nav.getByRole('button',{name:'add'})).toBeFocused();
 await nav.getByRole('button',{name:'import'}).click();
 dialog=page.getByRole('dialog',{name:'Import a recipe'});
 await expect(dialog.getByRole('button',{name:'Close importer'})).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 expect(await dialog.evaluate(node=>node.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(nav.getByRole('button',{name:'import'})).toBeFocused();
});
test('collection async contention rejects double save, failure surfaced and close blocked while busy',async({page})=>{
 await page.goto(route);
 const nav=page.getByRole('navigation',{name:'Synthetic accessibility surfaces'});
 await page.getByRole('button',{name:'Fail next collection save'}).click();
 await nav.getByRole('button',{name:'collections'}).click();
 const dialog=page.getByRole('dialog',{name:'Save to collection'});
 const checkbox=dialog.getByRole('checkbox');
 await checkbox.check();
 await expect(checkbox).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Close'})).toBeDisabled();
 await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('alert')).toContainText('Could not save collection assignment');
 await expect(checkbox).not.toBeChecked();
 await expect(page.getByTestId('save-attempts')).toHaveText('1');
 await checkbox.check();
 await expect(checkbox).toBeChecked();
 await expect(page.getByTestId('save-attempts')).toHaveText('2');
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(nav.getByRole('button',{name:'collections'})).toBeFocused();
});
test('real Recovery sheet keyboard and offline IndexedDB remain available',async({page,context})=>{
 await page.goto(route);
 await context.setOffline(true);
 const nav=page.getByRole('navigation',{name:'Synthetic accessibility surfaces'});
 await nav.getByRole('button',{name:'recovery'}).click();
 const dialog=page.getByRole('dialog',{name:'Backup & recovery'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Close recovery'})).toBeFocused();
 await expect(dialog.getByText(/device can contain recipes/i)).toBeVisible();
 await page.keyboard.press('Shift+Tab');
 expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(nav.getByRole('button',{name:'recovery'})).toBeFocused();
});
test('editor Escape respects unsaved changes and focus remains contained',async({page})=>{
 await page.goto(route);
 const nav=page.getByRole('navigation',{name:'Synthetic accessibility surfaces'});
 await nav.getByRole('button',{name:'studio'}).click();
 const dialog=page.getByRole('dialog',{name:'Make this recipe yours.'});
 await expect(dialog).toBeVisible();
 await dialog.getByRole('textbox',{name:'Name'}).fill('Changed without save');
 page.once('dialog',async confirmation=>{expect(confirmation.type()).toBe('confirm');await confirmation.dismiss();});
 await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();
 page.once('dialog',async confirmation=>{await confirmation.accept();});
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
});
test('all sheet surfaces keep controls visible at 400% desktop/200% mobile and reduced motion',async({page},testInfo)=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(route);
 const factor=testInfo.project.name.startsWith('mobile')?2:4;
 const nav=page.getByRole('navigation',{name:'Synthetic accessibility surfaces'});
 for(const surface of ['add','import','collections','recovery'] as const){
   await nav.getByRole('button',{name:surface}).click();
   const dialog=page.getByRole('dialog');
   await expect(dialog).toBeVisible();
   await page.evaluate(factor=>{document.documentElement.style.zoom=String(factor);},factor);
   const width=await page.evaluate(()=>({
     scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
   }));
   expect(width.scroll).toBeLessThanOrEqual(width.client+1);
   await expect(dialog).toBeInViewport({ratio:0.1});
   const names={add:'Close',import:'Close importer',collections:'Close',recovery:'Close recovery'};
   await expect(dialog.getByRole('button',{name:names[surface],exact:true})).toBeVisible();
   await page.screenshot({path:'test-results/p20-'+testInfo.project.name+'-'+surface+'-zoom.png',fullPage:true});
   await page.keyboard.press('Escape');
   await expect(dialog).toHaveCount(0);
   await page.evaluate(()=>{document.documentElement.style.zoom='1';});
 }
});
