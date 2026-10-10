/**
 * Synchronous UI write lock: React state is not a reliable concurrency guard
 * before its next render. This does not confer data ownership or permission.
 */
export function createExclusiveActionGate() {
  let busy=false;
  return {
    get busy(){return busy;},
    async run(work:()=>Promise<void>):Promise<'accepted'|'busy'> {
      if(busy)return 'busy';
      busy=true;
      try {
        await work();
        return 'accepted';
      } finally {
        busy=false;
      }
    },
  };
}
