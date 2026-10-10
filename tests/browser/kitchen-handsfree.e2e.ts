import { expect, test } from '@playwright/test';

const fixture='/tests/browser/kitchen-handsfree.html';
test('actual Kitchen controls are accessible, bounded and responsive without speech APIs', async ({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'SpeechRecognition',{configurable:true,value:undefined});
    Object.defineProperty(window,'webkitSpeechRecognition',{configurable:true,value:undefined});
  });
  await page.goto(fixture);
  await expect(page.getByRole('heading',{name:'Hands-free cooking'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Previous step'})).toBeDisabled();
  await page.getByRole('button',{name:'Next step'}).click();
  await expect(page.getByTestId('fixture-step')).toHaveText('Step 2');
  await page.getByRole('button',{name:'Previous step'}).click();
  await expect(page.getByTestId('fixture-step')).toHaveText('Step 1');
  await expect(page.getByText(/Voice recognition unavailable/)).toBeVisible();
  await expect(page.getByText(/Your browser may process speech remotely/)).toBeVisible();
  const widths=await page.evaluate(()=>({
    viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport+1);
});

test('microphone is push-to-talk, one command and stops after recognition',async({page})=>{
  await page.addInitScript(()=>{
    class FakeRecognition {
      lang='';continuous=false;interimResults=false;
      onresult:((e:unknown)=>void)|null=null;
      onerror:((e:unknown)=>void)|null=null;
      onend:(()=>void)|null=null;
      start(){(window as unknown as {voiceCommand:(s:string)=>void}).voiceCommand=(s:string)=>{
        this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:s}}]});
      };}
      stop(){this.onend?.();}
      abort(){this.onend?.();}
    }
    (window as unknown as {SpeechRecognition:unknown}).SpeechRecognition=FakeRecognition;
  });
  await page.goto(fixture);
  await page.getByRole('button',{name:'Listen for one command'}).click();
  await expect(page.getByRole('button',{name:'Stop listening'})).toBeVisible();
  await page.evaluate(()=>(window as unknown as {voiceCommand:(s:string)=>void}).voiceCommand('next step'));
  await expect(page.getByTestId('fixture-step')).toHaveText('Step 2');
  await expect(page.getByRole('button',{name:'Listen for one command'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Completion was not marked');
  await page.getByRole('button',{name:'Listen for one command'}).click();
  await page.getByRole('button',{name:'Stop listening'}).click();
  await expect(page.getByRole('button',{name:'Listen for one command'})).toBeVisible();
});

test('two timers expire individually with explicit visual fallback',async({page})=>{
  await page.goto(fixture);
  await page.getByRole('button',{name:'Start demo timer'}).click();
  await page.getByRole('button',{name:'Start demo timer'}).click();
  await expect(page.getByRole('alert')).toContainText('Quick timer',{timeout:7000});
  await expect(page.getByRole('alert')).toContainText('Long timer',{timeout:7000});
  await page.getByRole('button',{name:'Dismiss demo timers'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});


test('denied notification permission keeps foreground timer alerts working',async({page})=>{
  await page.addInitScript(()=>{
    class DeniedNotification {
      static permission='denied';
      static async requestPermission(){return 'denied';}
      constructor(){throw new Error('No notification should be shown when denied');}
    }
    Object.defineProperty(window,'Notification',{configurable:true,value:DeniedNotification});
  });
  await page.goto(fixture);
  await page.getByRole('button',{name:'Enable system notifications'}).click();
  await expect(page.getByText(/Notifications not permitted/)).toBeVisible();
  await page.getByRole('button',{name:'Start demo timer'}).click();
  await expect(page.getByRole('alert')).toContainText('Quick timer',{timeout:7000});
});

test('speech microphone permission refusal leaves safe manual navigation',async({page})=>{
  await page.addInitScript(()=>{
    class DeniedRecognition {
      lang='';continuous=false;interimResults=false;
      onresult:null=null;
      onerror:((e:{error:string})=>void)|null=null;
      onend:(()=>void)|null=null;
      start(){queueMicrotask(()=>this.onerror?.({error:'not-allowed'}));}
      stop(){this.onend?.();}
      abort(){this.onend?.();}
    }
    (window as unknown as {SpeechRecognition:unknown}).SpeechRecognition=DeniedRecognition;
  });
  await page.goto(fixture);
  await page.getByRole('button',{name:'Listen for one command'}).click();
  await expect(page.getByText(/Microphone access was blocked/)).toBeVisible();
  await page.getByRole('button',{name:'Next step'}).click();
  await expect(page.getByTestId('fixture-step')).toHaveText('Step 2');
});
