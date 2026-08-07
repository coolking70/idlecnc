export const NPM_TEST = {
  name: 'npm test',
  command: 'npm',
  args: ['test'],
  timeoutMs: 300000,
  category: 'npm'
};

export const EXTRA_NODE_TESTS = [
  'sandbox-opening-test.mjs',
  'sandbox-opening-patch-test.mjs',
  'sandbox-damage-repair-test.mjs',
  'sandbox-breakthrough-capture-test.mjs',
  'sandbox-integration-readiness-test.mjs',
  'sandbox-report-adapter-test.mjs',
  'contract-driven-victory-demo-test.mjs',
  'contract-demo-visual-integrity-test.mjs',
  'contract-victory-template-parameterization-test.mjs',
  'contract-victory-layout-generalization-test.mjs',
  'contract-route-deconfliction-test.mjs',
  'delivery-verifier-process-test.mjs'
].map((file) => ({
  name: `sandbox ${file}`,
  file,
  category: 'node',
  timeoutMs: 120000
}));

export const SERVER_REQUIRED_TESTS = [
  {
    name: 'sandbox-report-adapter-integrity-test',
    file: 'sandbox-report-adapter-integrity-test.mjs',
    category: 'server',
    timeoutMs: 180000
  }
];

export const VERIFICATION_MANIFEST = Object.freeze({
  npm: NPM_TEST,
  extraNodeTests: EXTRA_NODE_TESTS,
  serverRequiredTests: SERVER_REQUIRED_TESTS
});

export function manifestFiles() {
  return [...EXTRA_NODE_TESTS, ...SERVER_REQUIRED_TESTS].map((test) => test.file);
}
