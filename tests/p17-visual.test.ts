import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CookbookViewSwitch } from '../src/ui/CookbookViewSwitch.tsx';

describe('P17 view controls are semantic and local-only',()=>{
  it('represents grid selection with distinct labeled buttons',()=>{
    const html=renderToStaticMarkup(createElement(CookbookViewSwitch,{value:'grid',onChange:()=>{}}));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Recipe result layout"');
    expect(html).toMatch(/aria-label="Grid view" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="List view" aria-pressed="false"/);
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });
  it('represents list selection without disabling either layout control',()=>{
    const html=renderToStaticMarkup(createElement(CookbookViewSwitch,{value:'list',onChange:()=>{}}));
    expect(html).toMatch(/aria-label="Grid view" aria-pressed="false"/);
    expect(html).toMatch(/aria-label="List view" aria-pressed="true"/);
    expect(html).not.toContain('role="link"');
    expect(html).not.toContain('disabled');
  });
});
