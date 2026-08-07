export async function loadUniversalCorpus() {
  const [canonical, fuzzSpecs, coverage] = await Promise.all([
    fetch('./scenarios/canonical.json').then((response) => response.json()),
    fetch('./scenarios/fuzz-specs.json').then((response) => response.json()),
    fetch('./scenarios/coverage.json').then((response) => response.json())
  ]);
  return { rows: canonical, fuzzSpecs, coverage };
}
