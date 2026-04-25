class OrbitalTrace {
  constructor({ traceId, inputSize, steps, searchMeta = {} }) {
    this.traceId = traceId;
    this.inputSize = inputSize;
    this.steps = steps;
    this.searchMeta = searchMeta;
  }
}

function randomStep({ maxNodeId = 15 }) {
  return {
    nodeId: Math.floor(Math.random() * (maxNodeId + 1)),
    orbitCount: 1 + Math.floor(Math.random() * 3),
    ejectAngle: Math.random(),
    dwellTicks: Math.floor(Math.random() * 3),
    phaseOffset: Math.random(),
    nextNodeId: null,
  };
}

function cloneTrace(trace) {
  return new OrbitalTrace({
    traceId: trace.traceId,
    inputSize: trace.inputSize,
    steps: trace.steps.map(s => ({ ...s })),
    searchMeta: JSON.parse(JSON.stringify(trace.searchMeta || {})),
  });
}

module.exports = { OrbitalTrace, randomStep, cloneTrace };
