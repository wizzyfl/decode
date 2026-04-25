const { cloneTrace, randomStep } = require('../orbital/OrbitalTrace');

function mutateTrace(trace, options = {}) {
  const out = cloneTrace(trace);
  const steps = out.steps;
  if (!steps.length || Math.random() < 0.15) steps.push(randomStep({ maxNodeId: options.maxNodeId ?? 15 }));

  const choice = Math.random();
  if (choice < 0.25 && steps.length) {
    const i = Math.floor(Math.random() * steps.length);
    steps[i].nodeId = Math.floor(Math.random() * ((options.maxNodeId ?? 15) + 1));
  } else if (choice < 0.50 && steps.length) {
    const i = Math.floor(Math.random() * steps.length);
    steps[i].ejectAngle = (steps[i].ejectAngle + (Math.random() - 0.5) * 0.4 + 1) % 1;
  } else if (choice < 0.70 && steps.length) {
    const i = Math.floor(Math.random() * steps.length);
    steps[i].orbitCount = Math.max(1, Math.min(4, steps[i].orbitCount + (Math.random() < 0.5 ? -1 : 1)));
  } else if (choice < 0.85 && steps.length > 1) {
    steps.splice(Math.floor(Math.random() * steps.length), 1);
  } else {
    steps.splice(Math.floor(Math.random() * (steps.length + 1)), 0, randomStep({ maxNodeId: options.maxNodeId ?? 15 }));
  }
  out.traceId = `${trace.traceId}_m${Math.random().toString(36).slice(2, 8)}`;
  out.searchMeta.parentTraceIds = [trace.traceId];
  return out;
}

function crossover(a, b) {
  const cutA = Math.floor(Math.random() * Math.max(1, a.steps.length));
  const cutB = Math.floor(Math.random() * Math.max(1, b.steps.length));
  const steps = [...a.steps.slice(0, cutA), ...b.steps.slice(cutB)].map(s => ({ ...s }));
  return {
    traceId: `${a.traceId}_${b.traceId}_x${Math.random().toString(36).slice(2, 8)}`,
    inputSize: a.inputSize,
    steps,
    searchMeta: { parentTraceIds: [a.traceId, b.traceId] },
  };
}

module.exports = { mutateTrace, crossover };
