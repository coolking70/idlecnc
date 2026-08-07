const delayMs = Math.min(800, Math.max(300, Number(process.argv[2] || 500)));
const channel = process.argv[3] || 'stdout';
const durationMs = Number(process.argv[4] || 10000);

process.stdout.write('startup-output\n');

setTimeout(() => {
  if (channel === 'stdout') process.stdout.write('ready-worker-stdout\n');
  if (channel === 'stderr') process.stderr.write('ready-worker-stderr\n');
  process.stdout.write('worker-ready\n');
  setTimeout(() => {}, durationMs);
}, delayMs);
