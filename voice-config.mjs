import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
export const MODEL_ROOT = path.join(APP_ROOT, 'models');
export const POCKET_VOICES = [
  { name: 'pocket_charles', label: 'Charles · Pocket', culture: 'en' },
  { name: 'pocket_peter', label: 'Peter · British', culture: 'en-GB' },
];
export const NEURAL_VOICES = [
  { name: 'bm_george', label: 'George · British', culture: 'en-GB' },
  { name: 'bm_fable', label: 'Fable · British', culture: 'en-GB' },
  { name: 'am_michael', label: 'Michael · American', culture: 'en-US' },
  { name: 'bf_emma', label: 'Emma · British', culture: 'en-GB' },
  { name: 'af_heart', label: 'Heart · American', culture: 'en-US' },
  ...POCKET_VOICES,
];
export const DEFAULT_NEURAL_VOICE = 'bm_george';
