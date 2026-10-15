// The coordinator injects synchronous SQLite-backed store.save(). No filesystem or timers.
export function synchronousSave(store){const result=store?.save?.();if(result&&typeof result.then==='function')throw new TypeError('BOT store.save() must commit synchronously');}
export function persistentMap(st,save,key){
  const entries=()=>{const value=st()[key];return Array.isArray(value)?value:[];};
  const snapshot=()=>new Map(entries());
  const commit=map=>{st()[key]=[...map.entries()];const result=save();if(result&&typeof result.then==='function')throw new TypeError('BOT map persistence must commit synchronously');};
  return {
    get size(){return entries().length;},
    get(id){return snapshot().get(id);},has(id){return snapshot().has(id);},
    set(id,value){const map=snapshot();if(map.has(id)&&map.get(id)===value)return this;map.set(id,value);commit(map);return this;},
    delete(id){const map=snapshot();if(!map.delete(id))return false;commit(map);return true;},
    clear(){if(entries().length)commit(new Map());},
    keys(){return snapshot().keys();},values(){return snapshot().values();},entries(){return snapshot().entries();},
    [Symbol.iterator](){return snapshot()[Symbol.iterator]();},
  };
}
