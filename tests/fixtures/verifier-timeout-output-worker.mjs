const channel = process.argv[2];
const durationMs = Number(process.argv[3] || 10000);

if (channel === 'stdout') process.stdout.write('stdout-marker\n');
if (channel === 'stderr') process.stderr.write('stderr-marker\n');

process.stdout.write('worker-ready\n');
setTimeout(() => {}, durationMs);
