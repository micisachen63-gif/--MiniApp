import { GameError } from '../game/classes.js';

export class RealmError extends GameError {
  constructor(code, message, status = 409, options = {}) {
    super(code, message, status);
    this.name = 'RealmError';
    if (options.cause) this.cause = options.cause;
  }
}
