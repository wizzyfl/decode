/**
 * ORBITAL NEURAL SYSTEM — Core Engine
 * =====================================
 * Author: Wisam (concept) + Claude (implementation)
 *
 * Key innovation: Instead of gradient descent on weight matrices,
 * this system learns PATHS through a node graph. Each path is a
 * sequence of orbital hops, each hop applying a binary operation.
 * The system learns which paths solve which problems.
 *
 * Orbital operations (6 types):
 *   1: XOR(signal, input_bit)
 *   2: AND(signal, input_bit)
 *   3: OR(signal, input_bit)
 *   4: NOT(signal)
 *   5: XNOR(signal, input_bit)
 *   6: NOR(signal, input_bit)
 */

class OrbitalEngine {
  constructor(config = {}) {
    this.config = {
      inputSize:     config.inputSize     ?? 4,
      maxOrbits:     config.maxOrbits     ?? 6,
      maxHops:       config.maxHops       ?? 4,
      ensembleSize:  config.ensembleSize  ?? 30,
      learningRate:  config.learningRate  ?? 0.25,
      explorationRate: config.explorationRate ?? 0.20,
      eliteBoost:    config.eliteBoost    ?? 5.0,
      goodBoost:     config.goodBoost     ?? 2.0,
      badPenalty:    config.badPenalty    ?? 0.3,
      windowSize:    config.windowSize    ?? 100,
    };

    // Path registry: sig -> { weight, scores[], uses }
    this.paths = new Map();
    this.ensemble = [];       // Active top paths
    this.elitePaths = [];     // Confirmed 100% paths

    // Stats
    this.totalTrials  = 0;
    this.totalCorrect = 0;
    this.window       = [];   // Rolling accuracy window
    this.history      = [];   // Full accuracy history
  }

  // ── Core orbital computation ──────────────────────────────
  applyOrbit(signal, orbit, inputBit) {
    const b = inputBit ?? 0;
    switch (orbit) {
      case 1: return (signal ^ b) & 1;               // XOR
      case 2: return (signal & b) & 1;               // AND
      case 3: return (signal | b) & 1;               // OR
      case 4: return (signal === 0 ? 1 : 0) & 1;    // NOT
      case 5: return ((signal ^ b) === 0 ? 1 : 0);  // XNOR
      case 6: return ((signal | b) === 0 ? 1 : 0);  // NOR
      default: return signal & 1;
    }
  }

  // Evaluate an orbit chain on one input sample
  evalPath(orbits, inputs) {
    let signal = inputs.reduce((a, b) => a ^ b, 0) & 1; // XOR of all inputs as seed
    for (let h = 0; h < orbits.length; h++) {
      const bit = inputs[h % inputs.length];
      signal = this.applyOrbit(signal, orbits[h], bit);
    }
    return signal & 1;
  }

  // Score a path on a dataset
  scorePath(orbits, data) {
    if (!data.length) return 0;
    let correct = 0;
    for (const { input, label } of data) {
      if (this.evalPath(orbits, input) === label) correct++;
    }
    return correct / data.length;
  }

  // Encode orbit array as string key
  sig(orbits) { return orbits.join(","); }

  // Decode string key back to orbit array
  decode(sig) { return sig.split(",").map(Number); }

  // Generate a random orbit chain
  randomPath() {
    const len = Math.floor(Math.random() * (this.config.maxHops - 1)) + 1;
    return Array.from({ length: len }, () =>
      Math.floor(Math.random() * this.config.maxOrbits) + 1
    );
  }

  // Choose a path — epsilon-greedy with elite exploitation
  choosePath() {
    const { explorationRate } = this.config;

    // Exploit known elite paths 60% of time (if any exist)
    if (this.elitePaths.length > 0 && Math.random() < 0.60) {
      const base = this.elitePaths[Math.floor(Math.random() * this.elitePaths.length)];
      // Optionally mutate
      if (Math.random() < 0.25) {
        return base.map(o => Math.random() < 0.20
          ? Math.floor(Math.random() * this.config.maxOrbits) + 1
          : o
        );
      }
      return [...base];
    }

    // Explore
    if (Math.random() < explorationRate || !this.ensemble.length) {
      return this.randomPath();
    }

    // Sample from weighted ensemble
    const weights = this.ensemble.map(e => {
      const p = this.paths.get(this.sig(e));
      return p ? Math.pow(p.weight, 2) : 0.25;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < this.ensemble.length; i++) {
      r -= weights[i];
      if (r <= 0) return [...this.ensemble[i]];
    }
    return [...this.ensemble[this.ensemble.length - 1]];
  }

  // Train on a batch of samples
  trainBatch(batch, candidates = 25) {
    const { learningRate, eliteBoost, goodBoost, badPenalty, ensembleSize } = this.config;

    for (let k = 0; k < candidates; k++) {
      const orbits = this.choosePath();
      const s = this.sig(orbits);
      const score = this.scorePath(orbits, batch);

      // Weight update
      const entry = this.paths.get(s) ?? { weight: 0.5, scores: [], uses: 0 };
      const boost = score >= 1.0 ? eliteBoost : score >= 0.75 ? goodBoost : badPenalty;
      entry.weight = Math.max(0.01, Math.min(0.99,
        entry.weight + learningRate * boost * (score - entry.weight)
      ));
      entry.scores.push(score);
      if (entry.scores.length > 50) entry.scores.shift();
      entry.uses++;
      this.paths.set(s, entry);

      // Register elite paths
      if (score >= 1.0 && !this.elitePaths.some(e => this.sig(e) === s)) {
        this.elitePaths.push(orbits);
        if (this.elitePaths.length > 40) this.elitePaths.shift();
      }
    }

    // Rebuild ensemble: top paths by average score
    const ranked = [...this.paths.entries()]
      .map(([s, p]) => {
        const avg = p.scores.length
          ? p.scores.reduce((a, b) => a + b, 0) / p.scores.length
          : 0;
        return { orbits: this.decode(s), avg, weight: p.weight };
      })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, ensembleSize);

    this.ensemble = ranked.map(r => r.orbits);
  }

  // Train on a single sample
  train(input, label, dataPool = null) {
    const pool = dataPool ?? [{ input, label }];
    const batchSize = Math.min(16, pool.length);
    const batch = Array.from({ length: batchSize }, () =>
      pool[Math.floor(Math.random() * pool.length)]
    );
    batch.push({ input, label }); // Always include current
    this.trainBatch(batch);

    const pred = this.predict(input);
    const correct = pred === label;
    this.totalTrials++;
    if (correct) this.totalCorrect++;
    this.window.push(correct ? 1 : 0);
    if (this.window.length > this.config.windowSize) this.window.shift();

    return { pred, correct, orbits: this.ensemble[0] ?? [] };
  }

  // Predict using weighted ensemble vote
  predict(input) {
    if (!this.ensemble.length) return 0;
    let voteNum = 0, voteDen = 0;
    for (const orbits of this.ensemble) {
      const p = this.paths.get(this.sig(orbits));
      const w = p ? p.weight : 0.5;
      voteNum += this.evalPath(orbits, input) * w;
      voteDen += w;
    }
    return voteDen > 0 && voteNum / voteDen > 0.5 ? 1 : 0;
  }

  // Evaluate on full dataset
  evaluate(data) {
    let correct = 0;
    for (const { input, label } of data) {
      if (this.predict(input) === label) correct++;
    }
    return correct / data.length;
  }

  // Stats
  windowAccuracy() {
    return this.window.length
      ? this.window.reduce((a, b) => a + b, 0) / this.window.length
      : 0;
  }

  overallAccuracy() {
    return this.totalTrials ? this.totalCorrect / this.totalTrials : 0;
  }

  topPaths(n = 10) {
    return [...this.paths.entries()]
      .map(([s, p]) => {
        const avg = p.scores.length
          ? p.scores.reduce((a, b) => a + b, 0) / p.scores.length : 0;
        return { sig: s, weight: p.weight, avg, uses: p.uses };
      })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, n);
  }

  getStats() {
    return {
      totalTrials:   this.totalTrials,
      totalCorrect:  this.totalCorrect,
      windowAcc:     this.windowAccuracy(),
      overallAcc:    this.overallAccuracy(),
      pathsDiscovered: this.paths.size,
      elitePaths:    this.elitePaths.length,
      ensembleSize:  this.ensemble.length,
    };
  }

  reset() {
    this.paths.clear();
    this.ensemble = [];
    this.elitePaths = [];
    this.totalTrials = 0;
    this.totalCorrect = 0;
    this.window = [];
    this.history = [];
  }
}

module.exports = OrbitalEngine;
