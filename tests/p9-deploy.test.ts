import {describe,expect,it} from 'vitest';
import raw from '../vercel.json?raw';
import {sectionPath} from '../src/ui/navigation.ts';

const routes = JSON.parse(raw) as {rewrites:Array<{source:string;destination:string}>};
const bySource = new Map(routes.rewrites.map(({source,destination})=>[source,destination]));

describe('P8 production SPA routing',()=>{
 it('serves the Recipe frontend on Account OAuth callback',()=>{
  expect(bySource.get('/auth/callback')).toBe('/index.html');
 });
 it('handles direct links to every primary section and legacy cookbook location',()=>{
  for(const section of ['collections','cook','plan'] as const){
   expect(bySource.get(sectionPath(section))).toBe('/index.html');
   expect(bySource.get('/'+section+'/:path*')).toBe('/index.html');
  }
  expect(bySource.get('/recipes')).toBe('/index.html');
 });
 it('keeps API paths available for the future P7 MCP integration',()=>{
  expect(routes.rewrites.every(({source})=>!source.includes('api/')&&!source.includes('(.*)'))).toBe(true);
 });
});
