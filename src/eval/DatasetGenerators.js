function allBitVectors(n) {
  const out = [];
  for (let i = 0; i < (1 << n); i++) {
    out.push(Array.from({ length: n }, (_, j) => (i >> (n - 1 - j)) & 1));
  }
  return out;
}

function splitDataset(rows, valRatio = 0.25, testRatio = 0.25) {
  const total = rows.length;
  const testSize = Math.max(1, Math.floor(total * testRatio));
  const valSize = Math.max(1, Math.floor(total * valRatio));
  const trainSize = Math.max(1, total - valSize - testSize);
  return {
    train: rows.slice(0, trainSize),
    val: rows.slice(trainSize, trainSize + valSize),
    test: rows.slice(trainSize + valSize),
  };
}

function parityDataset(bits) {
  return allBitVectors(bits).map(input => ({ input, label: input.reduce((a, b) => a ^ b, 0) & 1 }));
}

function majorityDataset(bits) {
  return allBitVectors(bits).map(input => ({ input, label: input.reduce((a, b) => a + b, 0) >= Math.ceil(bits / 2) ? 1 : 0 }));
}

function thresholdDataset(bits, threshold) {
  return allBitVectors(bits).map(input => ({ input, label: input.reduce((a, b) => a + b, 0) >= threshold ? 1 : 0 }));
}

function compositeDataset(bits) {
  const half = bits / 2;
  return allBitVectors(bits).map(input => {
    const left = input.slice(0, half);
    const right = input.slice(half);
    const leftParity = left.reduce((a, b) => a ^ b, 0) & 1;
    const rightMajority = right.reduce((a, b) => a + b, 0) >= Math.ceil(right.length / 2) ? 1 : 0;
    return { input, label: (leftParity & rightMajority) & 1 };
  });
}

module.exports = {
  allBitVectors,
  splitDataset,
  parityDataset,
  majorityDataset,
  thresholdDataset,
  compositeDataset,
};
