import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'data', 'exercises.json');
const outputDir = path.join(root, 'public', 'data');
const output = path.join(outputDir, 'exercises.min.json');

const raw = JSON.parse(await fs.readFile(input, 'utf8'));
if (!Array.isArray(raw) || raw.length === 0) throw new Error('data/exercises.json is empty or invalid');

const compact = raw.map((exercise) => ({
  id: String(exercise.id),
  name: String(exercise.name ?? ''),
  bodyPart: String(exercise.body_part ?? ''),
  equipment: String(exercise.equipment ?? ''),
  target: String(exercise.target ?? ''),
  muscleGroup: String(exercise.muscle_group ?? ''),
  secondaryMuscles: Array.isArray(exercise.secondary_muscles) ? exercise.secondary_muscles : [],
  instructionsEs: exercise.instructions?.es || exercise.instructions?.en || '',
  instructionStepsEs: exercise.instruction_steps?.es?.length
    ? exercise.instruction_steps.es
    : exercise.instruction_steps?.en ?? [],
  image: `/${String(exercise.image ?? '').replace(/^\/+/, '')}`,
  gifUrl: `/${String(exercise.gif_url ?? '').replace(/^\/+/, '')}`,
  attribution: String(exercise.attribution ?? ''),
}));

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(output, JSON.stringify(compact));
console.log(`Prepared ${compact.length} exercises -> ${path.relative(root, output)}`);
