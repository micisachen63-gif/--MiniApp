import {MONSTER_ART_REVISION} from '../src/game/monster-art-compatibility.js';

// These integration fixtures model a current Mini App. Compatibility tests use
// the native Request explicitly to exercise missing and obsolete revisions.
export class CurrentClientRequest extends Request {
  constructor(input, init) {
    super(input, init);
    if(new URL(this.url).pathname.startsWith('/app/api/')&&!this.headers.has('X-Monster-Art-Revision'))
      this.headers.set('X-Monster-Art-Revision',MONSTER_ART_REVISION);
  }
}
