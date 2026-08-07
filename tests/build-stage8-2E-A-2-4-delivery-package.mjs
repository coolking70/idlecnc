process.env.IRON_COMMAND_VERIFY_OUTPUT_PREFIX = 'stage8-2E-A-2-4';
process.env.IRON_COMMAND_VERIFY_ARCHIVE = 'iron-command-stage8-2E-A-2-4-verifier-stability-final.zip';
process.env.IRON_COMMAND_VERIFY_DELIVERY_DOC = 'STAGE8-2E-A-2-4-DELIVERY.md';
process.env.IRON_COMMAND_VERIFY_VERIFIER = 'tests/verify-stage8-2E-A-2-4-delivery-package.mjs';
await import('./build-stage8-2E-A-2-delivery-package.mjs');
