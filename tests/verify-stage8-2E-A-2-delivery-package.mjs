// Compatibility entry point retained for the A.2/A.2.1 command name.
// The scalable A.2.2 runner owns process groups, servers, deadlines and cleanup.
// Child env isolation is assembled by the delegated verifier before every command.
// The delegated stages include browser evidence from formal-battle-evidence.mjs.
import { runPackage } from './verify-stage8-2E-A-2-2-delivery-package.mjs';

const LEGACY_NPM_STAGE_TIMEOUT_MS = 300000;
const archive = process.argv[2];
runPackage(archive).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = error.abortReason === 'global_verification_timeout' ? 124 : 1;
});
