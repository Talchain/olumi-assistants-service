import { retrySchemaPinningGoal } from '../runtime/build-model.js';
export const bad: number = retrySchemaPinningGoal({} as never, 'x', 3);
