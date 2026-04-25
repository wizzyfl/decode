const Executor = require('../isa/Executor');

class ProgramEvaluator {
  constructor(config = {}) {
    this.executor = new Executor({ traceEnabled: false, maxInstructions: config.maxInstructions ?? 64 });
  }

  accuracy(program, rows) {
    if (!rows.length) return 0;
    let correct = 0;
    for (const row of rows) {
      const out = this.executor.run(program, row.input).output;
      if (out === row.label) correct++;
    }
    return correct / rows.length;
  }

  evaluate(program, split) {
    const trainAccuracy = this.accuracy(program, split.train);
    const valAccuracy = this.accuracy(program, split.val);
    const testAccuracy = this.accuracy(program, split.test);
    return {
      trainAccuracy,
      valAccuracy,
      testAccuracy,
      instructionCount: program.length,
      exact: trainAccuracy === 1 && valAccuracy === 1 && testAccuracy === 1,
    };
  }
}

module.exports = ProgramEvaluator;
