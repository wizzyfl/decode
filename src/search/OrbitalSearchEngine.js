const crypto = require('crypto');
const { OrbitalTrace, randomStep } = require('../orbital/OrbitalTrace');
const { mutateTrace, crossover } = require('./Mutations');
const CompilerSpec = require('../compiler/CompilerSpec');
const OrbitalPathCompiler = require('../compiler/OrbitalPathCompiler');
const ProgramEvaluator = require('../eval/ProgramEvaluator');

class OrbitalSearchEngine {
  constructor(config = {}) {
    this.config = {
      beamWidth: config.beamWidth ?? 48,
      populationSize: config.populationSize ?? 96,
      generations: config.generations ?? 80,
      initialMinSteps: config.initialMinSteps ?? 2,
      initialMaxSteps: config.initialMaxSteps ?? 8,
      maxNodeId: config.maxNodeId ?? 15,
    };
    this.compilerSpec = new CompilerSpec({ maxProgramLength: config.maxProgramLength ?? 64 });
    this.compiler = new OrbitalPathCompiler(this.compilerSpec);
    this.evaluator = new ProgramEvaluator();
    this.opToNode = Object.fromEntries(Object.entries(this.compilerSpec.nodeOpMap).map(([k, v]) => [v, Number(k)]));
  }

  search({ taskId, inputSize, split }) {
    let population = this.#initialPopulation(taskId, inputSize);
    let best = null;
    const log = [];

    for (let gen = 0; gen < this.config.generations; gen++) {
      const evaluated = [];
      const dedupe = new Set();
      for (const trace of population) {
        const compiled = this.compiler.compile(trace);
        if (!compiled.valid) continue;
        const sig = JSON.stringify(compiled.program);
        if (dedupe.has(sig)) continue;
        dedupe.add(sig);
        const metrics = this.evaluator.evaluate(compiled.program, split);
        const score = this.#score(metrics);
        const programHash = crypto.createHash('sha1').update(sig).digest('hex').slice(0, 12);
        const item = { taskId, trace, compiled, metrics, score, programHash };
        evaluated.push(item);
        if (!best || item.score > best.score || (item.score === best.score && item.metrics.instructionCount < best.metrics.instructionCount)) best = item;
      }
      evaluated.sort((a, b) => b.score - a.score || a.metrics.instructionCount - b.metrics.instructionCount);
      const elites = evaluated.slice(0, this.config.beamWidth);
      log.push({ generation: gen, bestScore: elites[0]?.score ?? 0, bestValAccuracy: elites[0]?.metrics.valAccuracy ?? 0, bestTestAccuracy: elites[0]?.metrics.testAccuracy ?? 0, topProgramHash: elites[0]?.programHash ?? null });
      if (best && best.metrics.exact) break;
      population = this.#nextPopulation(elites, taskId, inputSize);
    }

    return { best, log, compilerVersion: this.compiler.version };
  }

  #score(metrics) {
    return (metrics.valAccuracy * 1000) + (metrics.testAccuracy * 100) + (metrics.trainAccuracy * 10) - metrics.instructionCount;
  }

  #initialPopulation(taskId, inputSize) {
    const pop = [];
    for (const trace of this.#motifSeeds(taskId, inputSize)) pop.push(trace);
    while (pop.length < this.config.populationSize) {
      const steps = [];
      const count = this.config.initialMinSteps + Math.floor(Math.random() * (this.config.initialMaxSteps - this.config.initialMinSteps + 1));
      for (let i = 0; i < count; i++) steps.push(randomStep({ maxNodeId: this.config.maxNodeId }));
      pop.push(new OrbitalTrace({ traceId: `trace_${Math.random().toString(36).slice(2, 10)}`, inputSize, steps, searchMeta: { generation: 0, parentTraceIds: [], seedType: 'random' } }));
    }
    return pop;
  }

  #motifSeeds(taskId, inputSize) {
    const seeds = [];
    const pushProgram = (name, program) => seeds.push(this.#programToTrace(program, inputSize, name));

    // Generic motifs
    for (let i = 0; i < inputSize; i++) {
      pushProgram(`setbit_${i}`, [{ op: 'SET_BIT', arg: i }, { op: 'RETURN' }]);
      pushProgram(`xor_single_${i}`, [{ op: 'SET_CONST', arg: 0 }, { op: 'XOR_BIT', arg: i }, { op: 'RETURN' }]);
    }

    // Reduction motifs
    pushProgram('xor_reduce', [{ op: 'SET_BIT', arg: 0 }, ...Array.from({ length: inputSize - 1 }, (_, i) => ({ op: 'XOR_BIT', arg: i + 1 })), { op: 'RETURN' }]);
    for (let threshold = 1; threshold <= inputSize; threshold++) {
      pushProgram(`count_ge_${threshold}`, [{ op: 'RESET_COUNT' }, ...Array.from({ length: inputSize }, (_, i) => ({ op: 'ADD_BIT', arg: i })), { op: 'COUNT_GE', arg: threshold }, { op: 'RETURN' }]);
    }

    if (taskId.includes('composite')) {
      const half = inputSize / 2;
      pushProgram('composite_parity_majority', [
        { op: 'SET_BIT', arg: 0 },
        ...Array.from({ length: half - 1 }, (_, i) => ({ op: 'XOR_BIT', arg: i + 1 })),
        { op: 'STORE_MEM' },
        { op: 'RESET_COUNT' },
        ...Array.from({ length: half }, (_, i) => ({ op: 'ADD_BIT', arg: i + half })),
        { op: 'COUNT_GE', arg: Math.ceil(half / 2) },
        { op: 'AND_MEM' },
        { op: 'RETURN' },
      ]);
    }
    return seeds;
  }

  #programToTrace(program, inputSize, seedType) {
    const steps = program.map(inst => {
      let angle = 0;
      if (typeof inst.arg === 'number') {
        if (['SET_BIT', 'XOR_BIT', 'AND_BIT', 'OR_BIT', 'ADD_BIT'].includes(inst.op)) angle = (inst.arg + 0.01) / inputSize;
        else angle = inputSize ? (inst.arg / inputSize) : 0;
      }
      return {
        nodeId: this.opToNode[inst.op] ?? this.opToNode.NOOP ?? 16,
        orbitCount: 1,
        ejectAngle: angle,
        dwellTicks: 0,
        phaseOffset: 0,
        nextNodeId: null,
      };
    });
    return new OrbitalTrace({
      traceId: `seed_${seedType}_${Math.random().toString(36).slice(2, 8)}`,
      inputSize,
      steps,
      searchMeta: { generation: 0, parentTraceIds: [], seedType },
    });
  }

  #nextPopulation(elites, taskId, inputSize) {
    const next = elites.map(x => x.trace);
    while (next.length < this.config.populationSize) {
      if (elites.length >= 2 && Math.random() < 0.30) {
        const a = elites[Math.floor(Math.random() * elites.length)].trace;
        const b = elites[Math.floor(Math.random() * elites.length)].trace;
        next.push(new OrbitalTrace(crossover(a, b)));
      } else if (elites.length >= 1) {
        const base = elites[Math.floor(Math.random() * elites.length)].trace;
        next.push(mutateTrace(base, { maxNodeId: this.config.maxNodeId }));
      } else {
        next.push(...this.#initialPopulation(taskId, inputSize).slice(0, 1));
      }
    }
    return next.slice(0, this.config.populationSize);
  }
}

module.exports = OrbitalSearchEngine;
