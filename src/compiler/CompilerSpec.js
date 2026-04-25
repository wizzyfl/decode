const DEFAULT_NODE_OP_MAP = Object.freeze({
  0: 'SET_BIT',
  1: 'XOR_BIT',
  2: 'ADD_BIT',
  3: 'COUNT_GE',
  4: 'STORE_MEM',
  5: 'LOAD_MEM',
  6: 'AND_MEM',
  7: 'OR_MEM',
  8: 'XOR_MEM',
  9: 'AND_BIT',
  10: 'OR_BIT',
  11: 'NOT',
  12: 'SET_CONST',
  13: 'RESET_COUNT',
  14: 'COUNT_EQ',
  15: 'RETURN',
});

class CompilerSpec {
  constructor(config = {}) {
    this.version = config.version ?? '1.0';
    this.nodeOpMap = config.nodeOpMap ?? DEFAULT_NODE_OP_MAP;
    this.angleBuckets = config.angleBuckets ?? 1024;
    this.maxProgramLength = config.maxProgramLength ?? 64;
  }

  nodeToOp(nodeId) {
    return this.nodeOpMap[nodeId] ?? 'NOOP';
  }

  angleToIndex(angle, inputSize) {
    const normalized = ((angle % 1) + 1) % 1;
    return Math.min(inputSize - 1, Math.floor(normalized * inputSize));
  }

  angleToThreshold(angle, inputSize) {
    const normalized = ((angle % 1) + 1) % 1;
    return Math.max(0, Math.min(inputSize, Math.round(normalized * inputSize)));
  }
}

module.exports = CompilerSpec;
